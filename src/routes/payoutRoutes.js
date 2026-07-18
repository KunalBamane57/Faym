const express = require("express");

function createPayoutRoutes(payoutController) {
  const router = express.Router();

  // Advance payout processing
  router.post("/advance", payoutController.processAdvancePayouts);
  router.post("/advance/:userId", payoutController.processAdvanceForUser);

  // Reconciliation
  router.post("/reconcile", payoutController.reconcile);

  // User payout info
  router.get("/summary/:userId", payoutController.getUserSummary);
  router.get("/user/:userId", payoutController.getUserPayouts);

  // Failed payout recovery (Question 2)
  router.post("/recover", payoutController.recoverPayout);
  router.post("/recover/bulk", payoutController.bulkRecoverPayouts);

  return router;
}

module.exports = createPayoutRoutes;
