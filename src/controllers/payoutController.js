/**
 * Payout Controller
 * -----------------
 * REST API handlers for advance payouts, reconciliation, and payout recovery.
 */

class PayoutController {
  constructor({
    advancePayoutService,
    reconciliationService,
    payoutRecoveryService,
    payoutModel,
  }) {
    this.advancePayoutService = advancePayoutService;
    this.reconciliationService = reconciliationService;
    this.payoutRecoveryService = payoutRecoveryService;
    this.payoutModel = payoutModel;
  }

  /**
   * POST /api/payouts/advance
   * Trigger advance payout processing for all eligible sales.
   * Admin endpoint — simulates a cron job.
   */
  processAdvancePayouts = (req, res) => {
    try {
      const result = this.advancePayoutService.processAllAdvances();
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/payouts/advance/:userId
   * Trigger advance payout for a specific user.
   */
  processAdvanceForUser = (req, res) => {
    try {
      const result = this.advancePayoutService.processAdvanceForUser(req.params.userId);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/payouts/reconcile
   * Reconcile a batch of sales.
   * Body: { updates: [{ saleId, status }] }
   */
  reconcile = (req, res) => {
    try {
      const { updates } = req.body;

      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Request body must include 'updates' array with { saleId, status } items.",
        });
      }

      // Validate each update
      for (const upd of updates) {
        if (!upd.saleId || !upd.status) {
          return res.status(400).json({
            success: false,
            error: "Each update must have 'saleId' and 'status'.",
          });
        }
        if (!["approved", "rejected"].includes(upd.status)) {
          return res.status(400).json({
            success: false,
            error: `Invalid status '${upd.status}'. Must be 'approved' or 'rejected'.`,
          });
        }
      }

      const result = this.reconciliationService.reconcile(updates);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/payouts/summary/:userId
   * Get reconciliation summary for a user.
   */
  getUserSummary = (req, res) => {
    try {
      const summary = this.reconciliationService.getUserSummary(req.params.userId);
      return res.json({ success: true, data: summary });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/payouts/user/:userId
   * Get all payout records for a user.
   */
  getUserPayouts = (req, res) => {
    try {
      const payouts = this.payoutModel.findByUserId(req.params.userId);
      return res.json({ success: true, data: payouts, count: payouts.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/payouts/recover
   * Recover a failed/cancelled/rejected withdrawal.
   * Body: { withdrawalId, reason }
   */
  recoverPayout = (req, res) => {
    try {
      const { withdrawalId, reason } = req.body;

      if (!withdrawalId) {
        return res.status(400).json({
          success: false,
          error: "Missing required field: withdrawalId",
        });
      }

      const result = this.payoutRecoveryService.recoverFailedWithdrawal(
        withdrawalId,
        reason || "failed"
      );
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/payouts/recover/bulk
   * Bulk recover failed payouts.
   * Body: { failures: [{ withdrawalId, reason }] }
   */
  bulkRecoverPayouts = (req, res) => {
    try {
      const { failures } = req.body;

      if (!failures || !Array.isArray(failures)) {
        return res.status(400).json({
          success: false,
          error: "Request body must include 'failures' array.",
        });
      }

      const result = this.payoutRecoveryService.bulkRecover(failures);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = PayoutController;
