/**
 * WithdrawalService
 * =================
 * Manages user withdrawal requests with 24-hour cooldown enforcement.
 *
 * Business Rules:
 *   1. A user can only withdraw once every 24 hours.
 *   2. Withdrawal amount must not exceed available balance.
 *   3. Balance is debited immediately upon request creation.
 *
 * Design Decisions:
 *   1. Eager debit — Balance is debited when the withdrawal is created,
 *      not when it completes. This prevents over-withdrawal from concurrent
 *      requests. If the withdrawal fails, recovery service credits it back.
 *   2. Linked payout — Each withdrawal creates an associated payout record
 *      for audit trail.
 */
class WithdrawalService {
  /**
   * @param {Object} deps - { withdrawalModel, userModel, payoutModel, db }
   */
  constructor({ withdrawalModel, userModel, payoutModel, db }) {
    this.withdrawalModel = withdrawalModel;
    this.userModel = userModel;
    this.payoutModel = payoutModel;
    this.db = db;
  }

  /**
   * Initiate a withdrawal for a user.
   *
   * @param {string} userId
   * @param {number} amount
   * @returns {Object} The withdrawal record.
   * @throws {Error} If cooldown active, insufficient balance, or user not found.
   */
  initiateWithdrawal(userId, amount) {
    // Validate user exists
    const user = this.userModel.findById(userId);
    if (!user) throw new Error(`User ${userId} not found.`);

    // Check 24-hour cooldown
    if (!this.withdrawalModel.canWithdraw(userId)) {
      const last = this.withdrawalModel.getLastWithdrawal(userId);
      throw new Error(
        `Withdrawal cooldown active. You can only withdraw once every 24 hours. ` +
        `Last withdrawal: ${last ? last.created_at : "unknown"}.`
      );
    }

    // Validate amount
    if (amount <= 0) throw new Error("Withdrawal amount must be greater than zero.");
    if (amount > user.withdrawable_balance) {
      throw new Error(
        `Insufficient balance. Available: ₹${user.withdrawable_balance}, Requested: ₹${amount}`
      );
    }

    // Process atomically
    const withdrawFn = this.db.transaction(() => {
      // Debit the user's balance
      this.userModel.debitBalance(userId, amount);

      // Create a payout record
      const payout = this.payoutModel.create({
        userId,
        type: "final",
        amount,
        referenceIds: [],
      });

      // Create the withdrawal record linked to the payout
      const withdrawal = this.withdrawalModel.create({
        userId,
        amount,
        payoutId: payout.id,
      });

      // Move to processing (simulating payment initiation)
      this.payoutModel.updateStatus(payout.id, "processing");
      this.withdrawalModel.updateStatus(withdrawal.id, "processing");

      return { withdrawal, payout };
    });

    return withdrawFn();
  }

  /**
   * Complete a withdrawal (called by payment gateway callback).
   */
  completeWithdrawal(withdrawalId) {
    const withdrawal = this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} not found.`);
    if (withdrawal.status !== "processing") {
      throw new Error(`Withdrawal is '${withdrawal.status}', expected 'processing'.`);
    }

    const completeFn = this.db.transaction(() => {
      this.withdrawalModel.updateStatus(withdrawalId, "completed");
      if (withdrawal.payout_id) {
        this.payoutModel.updateStatus(withdrawal.payout_id, "completed");
      }
      return this.withdrawalModel.findById(withdrawalId);
    });

    return completeFn();
  }

  /**
   * Get withdrawal history for a user.
   */
  getWithdrawalHistory(userId) {
    return this.withdrawalModel.findByUserId(userId);
  }
}

module.exports = WithdrawalService;
