const initSqlJs = require("sql.js");
const path = require("path");
const fs = require("fs");

/**
 * Database Configuration
 * ---------------------
 * Uses SQLite via sql.js — a pure JavaScript/WASM implementation.
 * No native compilation required (works everywhere Node.js runs).
 *
 * Design Decision:
 *   sql.js is chosen for maximum portability (no node-gyp / C++ toolchain).
 *   The API surface is wrapped to match better-sqlite3 conventions
 *   (prepare/run/get/all) so the models don't need to know which driver is used.
 *
 * Persistence:
 *   The database is saved to disk after each write operation via saveToDisk().
 *   For testing, pass ":memory:" to skip persistence.
 */

let _db = null;
let _dbPath = null;

/**
 * Wrapper class that provides a better-sqlite3-compatible API
 * on top of sql.js for seamless model usage.
 */
class DatabaseWrapper {
  constructor(sqlJsDb, dbPath) {
    this._db = sqlJsDb;
    this._dbPath = dbPath;
  }

  /**
   * Execute raw SQL (CREATE TABLE, etc.)
   */
  exec(sql) {
    this._db.run(sql);
    this._save();
  }

  /**
   * Set pragmas.
   */
  pragma(sql) {
    this._db.run(`PRAGMA ${sql}`);
  }

  /**
   * Prepare a statement — returns an object with run/get/all methods.
   */
  prepare(sql) {
    const db = this._db;
    const wrapper = this;

    return {
      /**
       * Run a statement (INSERT/UPDATE/DELETE).
       * Returns { changes: number }
       */
      run(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
        wrapper._save();
        return { changes: db.getRowsModified() };
      },

      /**
       * Get a single row (SELECT ... LIMIT 1 style).
       * Returns an object or undefined.
       */
      get(...params) {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        const hasRow = stmt.step();
        if (!hasRow) {
          stmt.free();
          return undefined;
        }
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      },

      /**
       * Get all matching rows.
       * Returns an array of objects.
       */
      all(...params) {
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  /**
   * Wrap a function in a transaction.
   * sql.js doesn't have native transaction objects, so we use BEGIN/COMMIT/ROLLBACK.
   */
  transaction(fn) {
    const db = this._db;
    const wrapper = this;

    return (...args) => {
      db.run("BEGIN TRANSACTION");
      try {
        const result = fn(...args);
        db.run("COMMIT");
        wrapper._save();
        return result;
      } catch (err) {
        db.run("ROLLBACK");
        throw err;
      }
    };
  }

  /**
   * Save database to disk (no-op for in-memory databases).
   */
  _save() {
    if (this._dbPath && this._dbPath !== ":memory:") {
      const data = this._db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this._dbPath, buffer);
    }
  }

  /**
   * Close the database.
   */
  close() {
    this._db.close();
  }
}

/**
 * Initialize and return the database (async — must await).
 * @param {string} [dbPath] - File path or ":memory:" for tests.
 * @returns {Promise<DatabaseWrapper>}
 */
async function getDatabase(dbPath) {
  if (_db) return _db;

  const resolvedPath =
    dbPath || path.join(__dirname, "..", "..", "data", "payout.db");
  _dbPath = resolvedPath;

  const SQL = await initSqlJs();

  let sqlJsDb;
  if (resolvedPath === ":memory:") {
    sqlJsDb = new SQL.Database();
  } else {
    // Ensure data directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Load existing DB file if it exists
    if (fs.existsSync(resolvedPath)) {
      const fileBuffer = fs.readFileSync(resolvedPath);
      sqlJsDb = new SQL.Database(fileBuffer);
    } else {
      sqlJsDb = new SQL.Database();
    }
  }

  _db = new DatabaseWrapper(sqlJsDb, resolvedPath);
  return _db;
}

/**
 * Create an in-memory database (sync-like, for tests).
 * @returns {Promise<DatabaseWrapper>}
 */
async function createMemoryDatabase() {
  const SQL = await initSqlJs();
  const sqlJsDb = new SQL.Database();
  return new DatabaseWrapper(sqlJsDb, ":memory:");
}

/**
 * Initialize all database tables.
 * Idempotent — safe to call multiple times.
 */
function initializeDatabase(database) {
  database.exec(`
    -- ============================================================
    -- USERS TABLE
    -- ============================================================
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      email           TEXT UNIQUE NOT NULL,
      withdrawable_balance  REAL NOT NULL DEFAULT 0.0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- SALES TABLE
    -- ============================================================
    CREATE TABLE IF NOT EXISTS sales (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      brand           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'approved', 'rejected')),
      earning         REAL NOT NULL CHECK(earning >= 0),
      advance_paid    REAL NOT NULL DEFAULT 0.0,
      advance_locked  INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ============================================================
    -- PAYOUTS TABLE
    -- ============================================================
    CREATE TABLE IF NOT EXISTS payouts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      type            TEXT NOT NULL CHECK(type IN ('advance', 'final', 'adjustment')),
      amount          REAL NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'processing', 'completed',
                                         'failed', 'cancelled', 'rejected')),
      reference_ids   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- ============================================================
    -- WITHDRAWALS TABLE
    -- ============================================================
    CREATE TABLE IF NOT EXISTS withdrawals (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      amount          REAL NOT NULL CHECK(amount > 0),
      status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending', 'processing', 'completed',
                                         'failed', 'cancelled', 'rejected')),
      payout_id       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (payout_id) REFERENCES payouts(id)
    );

    -- ============================================================
    -- INDEXES
    -- ============================================================
    CREATE INDEX IF NOT EXISTS idx_sales_user_id        ON sales(user_id);
    CREATE INDEX IF NOT EXISTS idx_sales_status          ON sales(status);
    CREATE INDEX IF NOT EXISTS idx_sales_user_status     ON sales(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_payouts_user_id       ON payouts(user_id);
    CREATE INDEX IF NOT EXISTS idx_payouts_status         ON payouts(status);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id   ON withdrawals(user_id);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_created   ON withdrawals(user_id, created_at);
  `);

  database.pragma("foreign_keys = ON");

  return database;
}

/**
 * Reset database connection.
 */
function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

module.exports = { getDatabase, createMemoryDatabase, initializeDatabase, closeDatabase };
