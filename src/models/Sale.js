const { v4: uuidv4 } = require("uuid");

/**
 * Sale Model
 * ----------
 * Represents an individual affiliate sale.
 *
 * Status lifecycle:  pending → approved | rejected
 *
 * Key fields:
 *   - advance_paid:   Amount of advance already disbursed
 *   - advance_locked:  1 if advance has been processed (idempotency guard)
 */
class Sale {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new sale.
   * @param {Object} data - { userId, brand, earning }
   * @returns {Object} The created sale record.
   */
  create({ userId, brand, earning }) {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO sales (id, user_id, brand, status, earning, advance_paid, advance_locked)
      VALUES (?, ?, ?, 'pending', ?, 0.0, 0)
    `);
    stmt.run(id, userId, brand, earning);
    return this.findById(id);
  }

  /**
   * Find a sale by ID.
   */
  findById(id) {
    return this.db.prepare("SELECT * FROM sales WHERE id = ?").get(id);
  }

  /**
   * Get all sales for a user, optionally filtered by status.
   */
  findByUserId(userId, status = null) {
    if (status) {
      return this.db
        .prepare("SELECT * FROM sales WHERE user_id = ? AND status = ?")
        .all(userId, status);
    }
    return this.db.prepare("SELECT * FROM sales WHERE user_id = ?").all(userId);
  }

  /**
   * Get all pending sales that have NOT yet received an advance payout.
   * This is the core query for the advance payout job.
   */
  findEligibleForAdvance() {
    return this.db
      .prepare(
        "SELECT * FROM sales WHERE status = 'pending' AND advance_locked = 0"
      )
      .all();
  }

  /**
   * Get pending sales eligible for advance for a specific user.
   */
  findEligibleForAdvanceByUser(userId) {
    return this.db
      .prepare(
        "SELECT * FROM sales WHERE user_id = ? AND status = 'pending' AND advance_locked = 0"
      )
      .all(userId);
  }

  /**
   * Mark a sale as advance-locked and record the advance amount.
   * Uses advance_locked as an idempotency guard — once set, the sale
   * will never be picked up by the advance payout job again.
   */
  lockAdvance(id, advanceAmount) {
    const stmt = this.db.prepare(`
      UPDATE sales
      SET advance_paid = ?, advance_locked = 1, updated_at = datetime('now')
      WHERE id = ? AND advance_locked = 0
    `);
    const result = stmt.run(advanceAmount, id);
    return result.changes > 0; // false if already locked
  }

  /**
   * Update sale status during reconciliation.
   * Only pending sales can be reconciled.
   */
  updateStatus(id, newStatus) {
    if (!["approved", "rejected"].includes(newStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be 'approved' or 'rejected'.`);
    }
    const sale = this.findById(id);
    if (!sale) throw new Error(`Sale ${id} not found.`);
    if (sale.status !== "pending") {
      throw new Error(
        `Sale ${id} is already '${sale.status}'. Only pending sales can be reconciled.`
      );
    }

    const stmt = this.db.prepare(`
      UPDATE sales SET status = ?, updated_at = datetime('now') WHERE id = ?
    `);
    stmt.run(newStatus, id);
    return this.findById(id);
  }

  /**
   * Bulk update statuses (used in batch reconciliation).
   * @param {Array<{saleId: string, status: string}>} updates
   * @returns {Object} Summary of results.
   */
  bulkUpdateStatus(updates) {
    const results = { succeeded: [], failed: [] };

    const updateFn = this.db.transaction((items) => {
      for (const { saleId, status } of items) {
        try {
          const sale = this.updateStatus(saleId, status);
          results.succeeded.push(sale);
        } catch (err) {
          results.failed.push({ saleId, error: err.message });
        }
      }
    });

    updateFn(updates);
    return results;
  }
}

module.exports = Sale;
