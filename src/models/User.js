const { v4: uuidv4 } = require("uuid");

/**
 * User Model
 * ----------
 * Manages user records and their withdrawable balance.
 *
 * withdrawable_balance is the current amount the user can withdraw.
 * It is updated by:
 *   - Advance payouts   (+)
 *   - Final payouts     (+)
 *   - Adjustments       (- or +)
 *   - Withdrawals       (-)
 *   - Failed payout recovery (+)
 */
class User {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new user.
   */
  create({ name, email }) {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO users (id, name, email, withdrawable_balance)
      VALUES (?, ?, ?, 0.0)
    `);
    stmt.run(id, name, email);
    return this.findById(id);
  }

  /**
   * Find user by ID.
   */
  findById(id) {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  /**
   * Find user by email.
   */
  findByEmail(email) {
    return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  }

  /**
   * Get all users.
   */
  findAll() {
    return this.db.prepare("SELECT * FROM users").all();
  }

  /**
   * Credit (add) an amount to the user's withdrawable balance.
   * Returns the updated user.
   */
  creditBalance(userId, amount) {
    if (amount <= 0) throw new Error("Credit amount must be positive.");
    const stmt = this.db.prepare(`
      UPDATE users
      SET withdrawable_balance = withdrawable_balance + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    const result = stmt.run(amount, userId);
    if (result.changes === 0) throw new Error(`User ${userId} not found.`);
    return this.findById(userId);
  }

  /**
   * Debit (subtract) an amount from the user's withdrawable balance.
   * Throws if insufficient balance.
   */
  debitBalance(userId, amount) {
    if (amount <= 0) throw new Error("Debit amount must be positive.");
    const user = this.findById(userId);
    if (!user) throw new Error(`User ${userId} not found.`);
    if (user.withdrawable_balance < amount) {
      throw new Error(
        `Insufficient balance. Available: ₹${user.withdrawable_balance}, Requested: ₹${amount}`
      );
    }

    const stmt = this.db.prepare(`
      UPDATE users
      SET withdrawable_balance = withdrawable_balance - ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(amount, userId);
    return this.findById(userId);
  }

  /**
   * Adjust balance by a signed amount (can be negative for rejected-sale clawbacks).
   */
  adjustBalance(userId, amount) {
    const user = this.findById(userId);
    if (!user) throw new Error(`User ${userId} not found.`);

    const newBalance = user.withdrawable_balance + amount;
    // Balance can go negative only in extreme edge cases;
    // the system should generally prevent this.

    const stmt = this.db.prepare(`
      UPDATE users
      SET withdrawable_balance = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(newBalance, userId);
    return this.findById(userId);
  }
}

module.exports = User;
