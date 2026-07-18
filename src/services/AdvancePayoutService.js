/**
 * AdvancePayoutService
 * ====================
 * Responsible for calculating and disbursing advance payouts.
 *
 * Business Rule:
 *   Every pending sale is eligible for an advance payout of 10% of its earnings.
 *   Once an advance is processed, the sale is "locked" so that re-running the
 *   advance job never double-pays.
 *
 * Design Decisions:
 *   1. Idempotency — The `advance_locked` flag on the Sale ensures that even
 *      if the job runs multiple times (e.g., cron retries, manual triggers),
 *      no sale receives a duplicate advance.
 *   2. Atomicity — Each user's advance batch is wrapped in a transaction so
 *      that either ALL eligible sales are locked + balance credited, or NONE are.
 *   3. Per-sale tracking — advance_paid is stored on each sale (not just in
 *      aggregate), so final payout calculation can deduct per-sale.
 */

const ADVANCE_RATE = 0.10; // 10%

class AdvancePayoutService {
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
   * Process advance payouts for ALL users with eligible sales.
   * Designed to be called by a scheduled job (cron) or admin endpoint.
   *
   * @returns {Object} Summary of processed advances.
   */
  processAllAdvances() {
    const eligibleSales = this.saleModel.findEligibleForAdvance();

    // Group by userId
    const byUser = {};
    for (const sale of eligibleSales) {
      if (!byUser[sale.user_id]) byUser[sale.user_id] = [];
      byUser[sale.user_id].push(sale);
    }

    const results = [];

    for (const [userId, sales] of Object.entries(byUser)) {
      try {
        const result = this.processAdvanceForUser(userId, sales);
        results.push(result);
      } catch (err) {
        results.push({ userId, error: err.message });
      }
    }

    return {
      totalUsersProcessed: results.length,
      totalSalesProcessed: eligibleSales.length,
      details: results,
    };
  }

  /**
   * Process advance payout for a single user.
   * Runs inside a transaction for atomicity.
   *
   * @param {string} userId
   * @param {Array} [sales] - Optional pre-fetched eligible sales.
   * @returns {Object} Advance payout summary.
   */
  processAdvanceForUser(userId, sales = null) {
    const eligibleSales =
      sales || this.saleModel.findEligibleForAdvanceByUser(userId);

    if (eligibleSales.length === 0) {
      return { userId, advanceAmount: 0, salesProcessed: 0, message: "No eligible sales." };
    }

    // Run atomically
    const processFn = this.db.transaction(() => {
      let totalAdvance = 0;
      const processedSaleIds = [];

      for (const sale of eligibleSales) {
        const advanceAmount = +(sale.earning * ADVANCE_RATE).toFixed(2);

        // Lock the sale and record advance — returns false if already locked
        const locked = this.saleModel.lockAdvance(sale.id, advanceAmount);
        if (locked) {
          totalAdvance += advanceAmount;
          processedSaleIds.push(sale.id);
        }
        // If not locked, it was already processed (idempotency)
      }

      if (totalAdvance > 0) {
        // Credit user's withdrawable balance
        this.userModel.creditBalance(userId, +totalAdvance.toFixed(2));

        // Record the payout
        this.payoutModel.create({
          userId,
          type: "advance",
          amount: +totalAdvance.toFixed(2),
          referenceIds: processedSaleIds,
        });

        // Mark payout as completed immediately (advance is internal)
        // In production, this would go through a payment gateway first.
      }

      return {
        userId,
        advanceAmount: +totalAdvance.toFixed(2),
        salesProcessed: processedSaleIds.length,
        saleIds: processedSaleIds,
      };
    });

    return processFn();
  }
}

module.exports = AdvancePayoutService;
