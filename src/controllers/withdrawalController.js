/**
 * Withdrawal Controller
 * ---------------------
 * REST API handlers for user withdrawal operations.
 */

class WithdrawalController {
  constructor({ withdrawalService }) {
    this.withdrawalService = withdrawalService;
  }

  /**
   * POST /api/withdrawals
   * Initiate a withdrawal.
   * Body: { userId, amount }
   */
  initiateWithdrawal = (req, res) => {
    try {
      const { userId, amount } = req.body;

      if (!userId || amount === undefined) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields: userId, amount",
        });
      }

      if (typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({
          success: false,
          error: "Amount must be a positive number.",
        });
      }

      const result = this.withdrawalService.initiateWithdrawal(userId, amount);
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      // Distinguish between client errors (cooldown, balance) and server errors
      const isClientError =
        err.message.includes("cooldown") ||
        err.message.includes("Insufficient") ||
        err.message.includes("not found");
      const status = isClientError ? 400 : 500;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  /**
   * POST /api/withdrawals/:id/complete
   * Mark a withdrawal as completed (simulates payment gateway callback).
   */
  completeWithdrawal = (req, res) => {
    try {
      const result = this.withdrawalService.completeWithdrawal(req.params.id);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
  };

  /**
   * GET /api/withdrawals/user/:userId
   * Get withdrawal history for a user.
   */
  getWithdrawalHistory = (req, res) => {
    try {
      const history = this.withdrawalService.getWithdrawalHistory(req.params.userId);
      return res.json({ success: true, data: history, count: history.length });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  };
}

module.exports = WithdrawalController;
