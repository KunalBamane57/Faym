const { getDatabase, initializeDatabase } = require("../config/database");
const User = require("../models/User");
const Sale = require("../models/Sale");

async function seed() {
  const db = await getDatabase();
  initializeDatabase(db);
  const userModel = new User(db);
  const saleModel = new Sale(db);

  console.log("Seeding database...\n");

  let user = userModel.findByEmail("john@example.com");
  if (!user) {
    user = userModel.create({ name: "John Doe", email: "john@example.com" });
    console.log("Created user:", user.name, user.id);
  }

  let user2 = userModel.findByEmail("jane@example.com");
  if (!user2) {
    user2 = userModel.create({ name: "Jane Smith", email: "jane@example.com" });
    console.log("Created user:", user2.name, user2.id);
  }

  if (saleModel.findByUserId(user.id).length === 0) {
    saleModel.create({ userId: user.id, brand: "brand_1", earning: 40 });
    saleModel.create({ userId: user.id, brand: "brand_1", earning: 40 });
    saleModel.create({ userId: user.id, brand: "brand_1", earning: 40 });
    console.log("Created 3 sales for", user.name);
  }

  if (saleModel.findByUserId(user2.id).length === 0) {
    saleModel.create({ userId: user2.id, brand: "brand_2", earning: 100 });
    saleModel.create({ userId: user2.id, brand: "brand_3", earning: 50 });
    console.log("Created 2 sales for", user2.name);
  }

  console.log("\nSeeding complete!");
  db.close();
}

seed().catch(console.error);
