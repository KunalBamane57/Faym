const express = require("express");

function createSaleRoutes(saleController) {
  const router = express.Router();

  router.post("/", saleController.createSale);
  router.get("/:id", saleController.getSale);
  router.get("/user/:userId", saleController.getSalesByUser);

  return router;
}

module.exports = createSaleRoutes;
