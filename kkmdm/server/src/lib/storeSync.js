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

/**
 * Mirrors the Customer Support Desk's view of the stores: the name CSD shows
 * (the restaurant's, found by the 6-digit store ID, else the store's own),
 * its status as CSD sets it (active, pending, suspended, closed_*), and gone
 * only when CSD deleted it or it no longer exists at all. A store CSD reopens
 * comes back on the next run.
 */
async function syncStores() {
  const db = await source();
  if (!db) return { skipped: true, reason: "KNOTKITCHEN_MONGODB_URI not set" };
  const company = await Company.findOne().sort({ createdAt: 1 });
  if (!company) return { skipped: true, reason: "no company" };
  const restaurants = await db.collection("restaurants").find({ storeId: { $exists: true } }, { projection: { name: 1, storeId: 1 } }).toArray();
  const restaurantByStoreId = new Map(restaurants.map((r) => [r.storeId, r]));
  let created = 0, updated = 0, archived = 0, active = 0;
  const seen = new Set();
  const cursor = db.collection("stores").find({}, { projection: { storeId: 1, storeName: 1, status: 1, restaurantId: 1, isDeleted: 1 } });
  for await (const s of cursor) {
    if (!/^\d{6}$/.test(s.storeId || "")) continue;
    seen.add(s.storeId);
    const gone = Boolean(s.isDeleted) || s.status === "deleted";
    const r = restaurantByStoreId.get(s.storeId);
    const res = await Store.updateOne(
      { kkStoreId: s.storeId },
      {
        $set: {
          name: r?.name || s.storeName,
          kkStatus: s.status || "pending",
          kkRestaurantId: r?._id ? String(r._id) : s.restaurantId ? String(s.restaurantId) : undefined,
          archived: gone,
          syncedAt: new Date(),
        },
        $setOnInsert: { companyId: company._id },
      },
      { upsert: true },
    );
    if (res.upsertedCount) created++;
    else if (res.modifiedCount) updated++;
    if (gone) archived++;
    else if (s.status === "active") active++;
  }
  // Removed from KnotKitchen altogether: hidden too (stores added by hand, with no KK ID, stay).
  const removed = await Store.updateMany(
    { kkStoreId: { $nin: [...seen, null, ""] }, archived: { $ne: true } },
    { $set: { archived: true, kkStatus: "deleted", syncedAt: new Date() } },
  );
  return { created, updated, archived: archived + removed.modifiedCount, active, total: seen.size };
}

module.exports = { syncStores };
