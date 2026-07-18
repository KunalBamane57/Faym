const express = require("express");

function createUserRoutes(userController) {
  const router = express.Router();

  router.post("/", userController.createUser);
  router.get("/", userController.listUsers);
  router.get("/:id", userController.getUser);

  return router;
}

module.exports = createUserRoutes;
