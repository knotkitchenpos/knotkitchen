/**
 * mergeStoreDatabases.js
 *
 * Historically the admin portal (knotkitchen-admin/backend) and the POS backend
 * (pos-backend) defaulted to DIFFERENT MongoDB databases. Stores created from the
 * admin portal landed in one database while the POS looked them up in another,
 * producing "Invalid Store ID. Please check and try again." for a Store ID that
 * clearly existed.
 *
 * Both apps now share one database (pos-db by default). This script copies any
 * stores/restaurants/users that were stranded in the legacy databases into the
 * canonical one so previously created Store IDs keep working.
 *
 * Usage:
 *   node scripts/mergeStoreDatabases.js
 *   node scripts/mergeStoreDatabases.js --dry-run
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_HOST = process.env.MONGO_HOST || "mongodb://localhost:27017";
const TARGET_DB = process.env.TARGET_DB || "pos-db";
const LEGACY_DBS = (process.env.LEGACY_DBS || "knotkitchen,pos-system").split(",").map((d) => d.trim()).filter(Boolean);
const DRY_RUN = process.argv.includes("--dry-run");

const connect = (dbName) => mongoose.createConnection(`${MONGO_HOST}/${dbName}`).asPromise();

const run = async () => {
  console.log(`\n=== Merging store data into "${TARGET_DB}" ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  const target = await connect(TARGET_DB);
  const targetStores = target.db.collection("stores");
  const targetRestaurants = target.db.collection("restaurants");
  const targetUsers = target.db.collection("users");

  let copied = 0;
  let skipped = 0;

  for (const dbName of LEGACY_DBS) {
    if (dbName === TARGET_DB) continue;

    let source;
    try {
      source = await connect(dbName);
    } catch (err) {
      console.log(`- ${dbName}: unreachable (${err.message}), skipping`);
      continue;
    }

    const stores = await source.db.collection("stores").find({}).toArray();
    if (!stores.length) {
      console.log(`- ${dbName}: no stores found`);
      await source.close();
      continue;
    }

    console.log(`- ${dbName}: found ${stores.length} store(s)`);

    for (const store of stores) {
      const existing = await targetStores.findOne({ storeId: store.storeId });
      if (existing) {
        console.log(`  · ${store.storeId} (${store.storeName}) already exists in ${TARGET_DB}, skipping`);
        skipped++;
        continue;
      }

      // Pull across the linked restaurant (POS resolves menus/orders through it)
      let restaurant = null;
      if (store.restaurantId) {
        restaurant = await source.db.collection("restaurants").findOne({ _id: store.restaurantId });
      }
      if (!restaurant) {
        restaurant = await source.db.collection("restaurants").findOne({ storeId: store.storeId });
      }

      if (DRY_RUN) {
        console.log(`  · would copy ${store.storeId} (${store.storeName})`);
        copied++;
        continue;
      }

      if (restaurant) {
        const restExists = await targetRestaurants.findOne({ _id: restaurant._id });
        if (!restExists) {
          // storeId is a unique index on restaurants - clear it if already taken
          const storeIdTaken = await targetRestaurants.findOne({ storeId: restaurant.storeId });
          if (storeIdTaken) delete restaurant.storeId;
          await targetRestaurants.insertOne(restaurant);
        }

        // Bring the owner/staff accounts along so login works
        const users = await source.db.collection("users").find({ restaurantId: restaurant._id }).toArray();
        for (const user of users) {
          const userExists = await targetUsers.findOne({
            $or: [{ _id: user._id }, { email: user.email }, { phone: user.phone }],
          });
          if (!userExists) await targetUsers.insertOne(user);
        }
      }

      await targetStores.insertOne(store);
      console.log(`  · copied ${store.storeId} (${store.storeName})`);
      copied++;
    }

    await source.close();
  }

  console.log(`\n=== Done: ${copied} copied, ${skipped} already present ===`);

  const all = await targetStores.find({ isDeleted: { $ne: true } }).toArray();
  console.log(`\nStore IDs now usable in the POS (${all.length}):`);
  all.forEach((s) => console.log(`  ${s.storeId}  ${s.storeName}  [${s.status}]`));

  await target.close();
  process.exit(0);
};

run().catch((err) => {
  console.error("Merge failed:", err);
  process.exit(1);
});
