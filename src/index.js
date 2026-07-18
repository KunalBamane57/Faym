/**
 * Server Entry Point
 * ==================
 * Initializes the database and starts the Express server.
 */

const { getDatabase, initializeDatabase } = require("./config/database");
const createApp = require("./app");

const PORT = process.env.PORT || 3000;

async function main() {
  // Initialize database (async because sql.js loads WASM)
  const db = await getDatabase();
  initializeDatabase(db);

  // Create and start app
  const app = createApp(db);

  app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════════╗
  ║   User Payout Management System               ║
  ║   Running on http://localhost:${PORT}             ║
  ║                                               ║
  ║   API Endpoints:                              ║
  ║   ├── /api/users          (User management)   ║
  ║   ├── /api/sales          (Sales management)  ║
  ║   ├── /api/payouts        (Payout operations) ║
  ║   ├── /api/withdrawals    (Withdrawals)       ║
  ║   └── /api/health         (Health check)      ║
  ╚═══════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
