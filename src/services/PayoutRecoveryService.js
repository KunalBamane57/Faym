/**
 * PayoutRecoveryService
 * =====================
 * Question 2 — Handles failed/cancelled/rejected payout recovery.
 *
 * When a payout that was previously initiated fails, gets cancelled,
 * or is rejected by the payment provider:
 *   1. The failed amount is credited back to the user's withdrawable balance.
 *   2. The user can then initiate another withdrawal for that amount.
 *
 * Design Decisions:
 *   1. Single-responsibility — This service ONLY handles recovery, keeping
 *      the failure path cleanly separated from the success path.
 *   2. Idempotency — A payout/withdrawal can only be recovered once.
 *      The status transitions enforce this (only 'processing' → 'failed').
 *   3. Automatic balance restoration — Crediting happens atomically with
 *      the status update to prevent inconsistencies.
 */
class PayoutRecoveryService {
  /**
   * @param {Object} deps - { payoutModel, withdrawalModel, userModel, db }
   */
  constructor({ payoutModel, withdrawalModel, userModel, db }) {
    this.payoutModel = payoutModel;
    this.withdrawalModel = withdrawalModel;
    this.userModel = userModel;
    this.db = db;
  }

  /**
   * Mark a withdrawal as failed and credit the amount back.
   *
   * @param {string} withdrawalId
   * @param {string} reason - 'failed' | 'cancelled' | 'rejected'
   * @returns {Object} Recovery result.
   */
  recoverFailedWithdrawal(withdrawalId, reason = "failed") {
    const validReasons = ["failed", "cancelled", "rejected"];
    if (!validReasons.includes(reason)) {
      throw new Error(`Invalid failure reason: ${reason}. Must be one of: ${validReasons.join(", ")}`);
    }

    const withdrawal = this.withdrawalModel.findById(withdrawalId);
    if (!withdrawal) throw new Error(`Withdrawal ${withdrawalId} not found.`);

    // Only processing or pending withdrawals can fail
    if (!["processing", "pending"].includes(withdrawal.status)) {
      throw new Error(
        `Cannot recover withdrawal in status '${withdrawal.status}'. ` +
        `Only 'processing' or 'pending' withdrawals can be recovered.`
      );
    }

    const recoverFn = this.db.transaction(() => {
      // Update withdrawal status
      this.withdrawalModel.updateStatus(withdrawalId, reason);

      // Update linked payout status
      if (withdrawal.payout_id) {
        this.payoutModel.updateStatus(withdrawal.payout_id, reason);
      }

      // Credit the amount back to user's withdrawable balance
      this.userModel.creditBalance(withdrawal.user_id, withdrawal.amount);

      const updatedUser = this.userModel.findById(withdrawal.user_id);

      return {
        withdrawalId,
        userId: withdrawal.user_id,
        amountRecovered: withdrawal.amount,
        reason,
        newBalance: updatedUser.withdrawable_balance,
        message: `₹${withdrawal.amount} has been credited back to withdrawable balance.`,
      };
    });

    return recoverFn();
  }

  /**
   * Bulk recover all failed payouts (e.g., from payment gateway webhook batch).
   *
   * @param {Array<{withdrawalId: string, reason: string}>} failures
   * @returns {Object} Bulk recovery summary.
   */
  bulkRecover(failures) {
    const results = { succeeded: [], failed: [] };

    for (const { withdrawalId, reason } of failures) {
      try {
        const result = this.recoverFailedWithdrawal(withdrawalId, reason);
        results.succeeded.push(result);
      } catch (err) {
        results.failed.push({ withdrawalId, error: err.message });
      }
    }

    return results;
  }

  /**
   * Get all failed/cancelled/rejected withdrawals for a user.
   */
  getFailedWithdrawals(userId) {
    const all = this.withdrawalModel.findByUserId(userId);
    return all.filter((w) =>
      ["failed", "cancelled", "rejected"].includes(w.status)
    );
  }
}

module.exports = PayoutRecoveryService;
