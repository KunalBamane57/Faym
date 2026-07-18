/**
 * ReconciliationService
 * =====================
 * Handles admin reconciliation of sales and calculates final payouts.
 *
 * Reconciliation Flow:
 *   1. Admin updates each pending sale to 'approved' or 'rejected'.
 *   2. For each reconciled sale, the system calculates the final adjustment:
 *      - Approved: payout = earning - advance_paid  (remaining amount)
 *      - Rejected: payout = -advance_paid            (clawback)
 *   3. Net payout is credited/debited to the user's withdrawable balance.
 *
 * Design Decisions:
 *   1. Batch processing — Reconciliation is done per-user in a single
 *      transaction to maintain consistency.
 *   2. Detailed audit trail — Every reconciliation creates a payout record
 *      of type 'final' or 'adjustment' with full sale references.
 *   3. Negative adjustments — If rejected sales' clawbacks exceed approved
 *      payouts, the net can be negative. This is tracked as a negative
 *      adjustment to the balance.
 */
class ReconciliationService {
  /**
   * @param {Object} deps - { saleModel, userModel, payoutModel, db }
   */
  constructor({ saleModel, userModel, payoutModel, db }) {
    this.saleModel = saleModel;
    this.userModel = userModel;
    this.payoutModel = payoutModel;
    this.db = db;
  }

  /**
   * Reconcile a batch of sales.
   *
   * @param {Array<{saleId: string, status: string}>} updates
   *   Each item: { saleId, status: 'approved' | 'rejected' }
   * @returns {Object} Reconciliation summary with per-sale breakdown.
   */
  reconcile(updates) {
    const reconcileFn = this.db.transaction(() => {
      const results = [];
      const userAdjustments = {}; // userId → { totalFinal, details[] }

      for (const { saleId, status } of updates) {
        try {
          // Fetch current sale state
          const saleBefore = this.saleModel.findById(saleId);
          if (!saleBefore) {
            results.push({ saleId, error: "Sale not found." });
            continue;
          }
          if (saleBefore.status !== "pending") {
            results.push({
              saleId,
              error: `Sale already reconciled as '${saleBefore.status}'.`,
            });
            continue;
          }

          // Update sale status
          const saleAfter = this.saleModel.updateStatus(saleId, status);

          // Calculate final adjustment
          let finalAmount = 0;
          if (status === "approved") {
            // User gets full earning minus advance already paid
            finalAmount = +(saleAfter.earning - saleAfter.advance_paid).toFixed(2);
          } else if (status === "rejected") {
            // Clawback: user must return the advance
            finalAmount = +(-saleAfter.advance_paid).toFixed(2);
          }

          // Accumulate per-user
          const uid = saleAfter.user_id;
          if (!userAdjustments[uid]) {
            userAdjustments[uid] = { totalFinal: 0, saleIds: [], details: [] };
          }
          userAdjustments[uid].totalFinal += finalAmount;
          userAdjustments[uid].saleIds.push(saleId);
          userAdjustments[uid].details.push({
            saleId,
            brand: saleAfter.brand,
            status,
            earning: saleAfter.earning,
            advancePaid: saleAfter.advance_paid,
            finalAdjustment: finalAmount,
          });

          results.push({
            saleId,
            status,
            earning: saleAfter.earning,
            advancePaid: saleAfter.advance_paid,
            finalAdjustment: finalAmount,
          });
        } catch (err) {
          results.push({ saleId, error: err.message });
        }
      }

      // Apply user balance adjustments and create payout records
      const payoutSummaries = [];
      for (const [userId, data] of Object.entries(userAdjustments)) {
        const netAmount = +data.totalFinal.toFixed(2);

        // Adjust user balance (can be negative for net-rejected batches)
        this.userModel.adjustBalance(userId, netAmount);

        // Create a final payout record
        const payoutType = netAmount >= 0 ? "final" : "adjustment";
        const payout = this.payoutModel.create({
          userId,
          type: payoutType,
          amount: netAmount,
          referenceIds: data.saleIds,
        });

        // Mark as completed immediately (balance already adjusted)
        this.payoutModel.updateStatus(payout.id, "completed");

        payoutSummaries.push({
          userId,
          netPayout: netAmount,
          payoutId: payout.id,
          salesReconciled: data.saleIds.length,
          breakdown: data.details,
        });
      }

      return {
        salesProcessed: results.length,
        salesResults: results,
        payoutSummaries,
      };
    });

    return reconcileFn();
  }

  /**
   * Get reconciliation summary for a user.
   * Shows pending, approved, and rejected counts with financials.
   */
  getUserSummary(userId) {
    const allSales = this.saleModel.findByUserId(userId);
    const user = this.userModel.findById(userId);

    const summary = {
      userId,
      withdrawableBalance: user ? user.withdrawable_balance : 0,
      sales: {
        pending: { count: 0, totalEarning: 0, totalAdvancePaid: 0 },
        approved: { count: 0, totalEarning: 0, totalAdvancePaid: 0 },
        rejected: { count: 0, totalEarning: 0, totalAdvancePaid: 0 },
      },
    };

    for (const sale of allSales) {
      const bucket = summary.sales[sale.status];
      if (bucket) {
        bucket.count++;
        bucket.totalEarning += sale.earning;
        bucket.totalAdvancePaid += sale.advance_paid;
      }
    }

    // Round
    for (const key of ["pending", "approved", "rejected"]) {
      summary.sales[key].totalEarning = +summary.sales[key].totalEarning.toFixed(2);
      summary.sales[key].totalAdvancePaid = +summary.sales[key].totalAdvancePaid.toFixed(2);
    }

    return summary;
  }
}

module.exports = ReconciliationService;
