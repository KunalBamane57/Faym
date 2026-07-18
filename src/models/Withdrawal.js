const { v4: uuidv4 } = require("uuid");

/**
 * Withdrawal Model
 * ----------------
 * Tracks user-initiated withdrawal requests.
 *
 * Business Rule:
 *   A user can make only ONE withdrawal every 24 hours.
 *   This is enforced at the service layer using canWithdraw().
 */
class Withdrawal {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new withdrawal request.
   */
  create({ userId, amount, payoutId = null }) {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO withdrawals (id, user_id, amount, status, payout_id)
      VALUES (?, ?, ?, 'pending', ?)
    `);
    stmt.run(id, userId, amount, payoutId);
    return this.findById(id);
  }

  /**
   * Find withdrawal by ID.
   */
  findById(id) {
    return this.db.prepare("SELECT * FROM withdrawals WHERE id = ?").get(id);
  }

  /**
   * Get all withdrawals for a user.
   */
  findByUserId(userId) {
    return this.db
      .prepare("SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId);
  }

  /**
   * Update withdrawal status.
   */
  updateStatus(id, newStatus) {
    const valid = ["pending", "processing", "completed", "failed", "cancelled", "rejected"];
    if (!valid.includes(newStatus)) {
      throw new Error(`Invalid withdrawal status: ${newStatus}`);
    }
    const stmt = this.db.prepare(`
      UPDATE withdrawals SET status = ?, updated_at = datetime('now') WHERE id = ?
    `);
    const result = stmt.run(newStatus, id);
    if (result.changes === 0) throw new Error(`Withdrawal ${id} not found.`);
    return this.findById(id);
  }

  /**
   * Check if user can withdraw (24-hour cooldown).
   * Returns true if no completed/processing withdrawal exists in the last 24h.
   */
  canWithdraw(userId) {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM withdrawals
         WHERE user_id = ?
           AND status IN ('pending', 'processing', 'completed')
           AND created_at > datetime('now', '-24 hours')`
      )
      .get(userId);
    return row.cnt === 0;
  }

  /**
   * Get the last withdrawal for a user.
   */
  getLastWithdrawal(userId) {
    return this.db
      .prepare(
        `SELECT * FROM withdrawals
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(userId);
  }
}

module.exports = Withdrawal;
