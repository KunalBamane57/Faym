const express = require("express");

function createWithdrawalRoutes(withdrawalController) {
  const router = express.Router();

  router.post("/", withdrawalController.initiateWithdrawal);
  router.post("/:id/complete", withdrawalController.completeWithdrawal);
  router.get("/user/:userId", withdrawalController.getWithdrawalHistory);

  return router;
}

module.exports = createWithdrawalRoutes;
