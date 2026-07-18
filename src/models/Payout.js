const { v4: uuidv4 } = require("uuid");

/**
 * Payout Model
 * ------------
 * Tracks all payout events: advance payouts, final payouts, and adjustments.
 *
 * Status lifecycle:
 *   pending → processing → completed
 *                        → failed / cancelled / rejected
 *
 * reference_ids stores a JSON array of sale IDs that this payout relates to,
 * enabling full traceability.
 */
class Payout {
  constructor(db) {
    this.db = db;
  }

  /**
   * Create a new payout record.
   * @param {Object} data - { userId, type, amount, referenceIds }
   */
  create({ userId, type, amount, referenceIds = [] }) {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO payouts (id, user_id, type, amount, status, reference_ids)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `);
    stmt.run(id, userId, type, amount, JSON.stringify(referenceIds));
    return this.findById(id);
  }

  /**
   * Find payout by ID.
   */
  findById(id) {
    const row = this.db.prepare("SELECT * FROM payouts WHERE id = ?").get(id);
    if (row) row.reference_ids = JSON.parse(row.reference_ids || "[]");
    return row;
  }

  /**
   * Get all payouts for a user.
   */
  findByUserId(userId) {
    const rows = this.db
      .prepare("SELECT * FROM payouts WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId);
    return rows.map((r) => ({ ...r, reference_ids: JSON.parse(r.reference_ids || "[]") }));
  }

  /**
   * Update payout status.
   */
  updateStatus(id, newStatus) {
    const valid = ["pending", "processing", "completed", "failed", "cancelled", "rejected"];
    if (!valid.includes(newStatus)) {
      throw new Error(`Invalid payout status: ${newStatus}`);
    }
    const stmt = this.db.prepare(`
      UPDATE payouts SET status = ?, updated_at = datetime('now') WHERE id = ?
    `);
    const result = stmt.run(newStatus, id);
    if (result.changes === 0) throw new Error(`Payout ${id} not found.`);
    return this.findById(id);
  }

  /**
   * Get payouts by status.
   */
  findByStatus(status) {
    const rows = this.db
      .prepare("SELECT * FROM payouts WHERE status = ?")
      .all(status);
    return rows.map((r) => ({ ...r, reference_ids: JSON.parse(r.reference_ids || "[]") }));
  }
}

module.exports = Payout;
