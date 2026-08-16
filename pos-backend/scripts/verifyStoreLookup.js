/**
 * verifyStoreLookup.js
 *
 * Reproduces exactly what POST /api/user/store/validate-id does, so you can
 * confirm which Store IDs the POS will accept without starting the server.
 *
 * Usage: node scripts/verifyStoreLookup.js [storeId ...]
 */

require("dotenv").config();
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  await mongoose.connect(config.databaseURI);
  console.log(`POS backend database: ${mongoose.connection.name}\n`);

  const Store = mongoose.connection.db.collection("stores");
  const Restaurant = mongoose.connection.db.collection("restaurants");

  let ids = process.argv.slice(2);
  if (!ids.length) {
    const active = await Store.find({ isDeleted: { $ne: true } }).toArray();
    ids = active.map((s) => s.storeId);
  }

  for (const raw of ids) {
    const storeId = String(raw).trim();

    if (!/^\d{6}$/.test(storeId)) {
      console.log(`${storeId} -> REJECTED (Store ID must be a 6-digit number)`);
      continue;
    }

    const store = await Store.findOne({ storeId, isDeleted: { $ne: true } });
    let restaurant = await Restaurant.findOne({ storeId, isDeleted: { $ne: true } });
    if (!restaurant && store && store.restaurantId) {
      restaurant = await Restaurant.findOne({ _id: store.restaurantId, isDeleted: { $ne: true } });
    }

    if (!store && !restaurant) {
      console.log(`${storeId} -> INVALID STORE ID (404)`);
      continue;
    }

    if ((restaurant && restaurant.isActive === false) || (store && store.status === "suspended")) {
      console.log(`${storeId} -> INACTIVE (store suspended/deactivated)`);
      continue;
    }

    const name = restaurant ? restaurant.name : store.storeName;
    console.log(`${storeId} -> VALID  (${name})`);
  }

  await mongoose.disconnect();
  process.exit(0);
};

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
