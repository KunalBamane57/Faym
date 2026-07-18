/**
 * Application Factory
 * ===================
 * Creates and configures the Express application with all dependencies wired up.
 *
 * This factory pattern enables:
 *   - Easy testing (pass in-memory DB)
 *   - Clean dependency injection
 *   - Separation of server startup from app configuration
 */

const express = require("express");

// Models
const Sale = require("./models/Sale");
const User = require("./models/User");
const Payout = require("./models/Payout");
const Withdrawal = require("./models/Withdrawal");

// Services
const AdvancePayoutService = require("./services/AdvancePayoutService");
const ReconciliationService = require("./services/ReconciliationService");
const WithdrawalService = require("./services/WithdrawalService");
const PayoutRecoveryService = require("./services/PayoutRecoveryService");

// Controllers
const SaleController = require("./controllers/saleController");
const PayoutController = require("./controllers/payoutController");
const WithdrawalController = require("./controllers/withdrawalController");
const UserController = require("./controllers/userController");

// Routes
const createSaleRoutes = require("./routes/saleRoutes");
const createPayoutRoutes = require("./routes/payoutRoutes");
const createWithdrawalRoutes = require("./routes/withdrawalRoutes");
const createUserRoutes = require("./routes/userRoutes");

// Middleware
const { errorHandler, requestLogger } = require("./middleware/errorHandler");

function createApp(db) {
  const app = express();

  // Middleware
  app.use(express.json());
  app.use(requestLogger);

  // ──── Dependency Injection ────

  // Models
  const saleModel = new Sale(db);
  const userModel = new User(db);
  const payoutModel = new Payout(db);
  const withdrawalModel = new Withdrawal(db);

  // Services
  const advancePayoutService = new AdvancePayoutService({
    saleModel,
    userModel,
    payoutModel,
    db,
  });

  const reconciliationService = new ReconciliationService({
    saleModel,
    userModel,
    payoutModel,
    db,
  });

  const withdrawalService = new WithdrawalService({
    withdrawalModel,
    userModel,
    payoutModel,
    db,
  });

  const payoutRecoveryService = new PayoutRecoveryService({
    payoutModel,
    withdrawalModel,
    userModel,
    db,
  });

  // Controllers
  const saleController = new SaleController({ saleModel, userModel });
  const payoutController = new PayoutController({
    advancePayoutService,
    reconciliationService,
    payoutRecoveryService,
    payoutModel,
  });
  const withdrawalController = new WithdrawalController({ withdrawalService });
  const userController = new UserController({ userModel });

  // ──── Routes ────

  app.use("/api/users", createUserRoutes(userController));
  app.use("/api/sales", createSaleRoutes(saleController));
  app.use("/api/payouts", createPayoutRoutes(payoutController));
  app.use("/api/withdrawals", createWithdrawalRoutes(withdrawalController));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
