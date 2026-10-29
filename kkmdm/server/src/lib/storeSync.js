/**
 * Stores come from KnotKitchen's own restaurant records (pos-backend's
 * `stores` collection), read-only. KKMDM keeps the mapping
 * kkStoreId (6-digit) -> its own Store row and never edits the source.
 */
const mongoose = require("mongoose");
const config = require("../config");
const { Store, Company } = require("../models");

let conn = null;

async function source() {
  if (!config.knotkitchenMongoUri) return null;
  if (!conn) conn = await mongoose.createConnection(config.knotkitchenMongoUri, { readPreference: "secondaryPreferred" }).asPromise();
  return conn;
}

async function syncStores() {
  const db = await source();
  if (!db) return { skipped: true, reason: "KNOTKITCHEN_MONGODB_URI not set" };
  const company = await Company.findOne().sort({ createdAt: 1 });
  if (!company) return { skipped: true, reason: "no company" };
  let created = 0, updated = 0, archived = 0;
  const seen = new Set();
  const cursor = db.collection("stores").find({}, { projection: { storeId: 1, storeName: 1, status: 1, restaurantId: 1, isDeleted: 1 } });
  for await (const s of cursor) {
    if (!/^\d{6}$/.test(s.storeId || "")) continue;
    seen.add(s.storeId);
    const gone = s.isDeleted || s.status === "deleted" || s.status === "closed";
    const r = await Store.updateOne(
      { kkStoreId: s.storeId },
      {
        $set: { name: s.storeName, kkStatus: s.status, kkRestaurantId: s.restaurantId ? String(s.restaurantId) : undefined, archived: Boolean(gone), syncedAt: new Date() },
        $setOnInsert: { companyId: company._id },
      },
      { upsert: true },
    );
    if (r.upsertedCount) created++;
    else if (r.modifiedCount) updated++;
    if (gone) archived++;
  }
  return { created, updated, archived, total: seen.size };
}

module.exports = { syncStores };
