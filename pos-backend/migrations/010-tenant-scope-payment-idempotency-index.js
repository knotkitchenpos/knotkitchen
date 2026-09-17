/**
 * 010 - The four unique guards that never existed, and the payment key
 * scoped per restaurant.
 *
 * Six models declared a unique partial index with `$ne` in the filter.
 * MongoDB does not allow $ne there; it refused each one with
 * CannotCreateIndex, Mongoose logged it and carried on, and production ran
 * without: the QR double-scan guard (orders), the payment-transaction
 * dedupe, the table-session duplicate-payment guard, one-customer-per-phone,
 * one-live-table-number-per-restaurant and one-active-QR-per-table. The specs now use `$gt: ""` /
 * `isDeleted: false`, and the deployed model creates them on boot; this
 * creates them explicitly, reports any duplicate data that blocks one, and
 * drops the two stale names that stand in the way (the old global
 * table-session key, and a non-unique `restaurantId_1_tableNumber_1` whose
 * options conflict with the unique one).
 *
 * Raw driver, no Mongoose model. Deploy first, then run. Idempotent.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const GUARDS = [
  {
    collection: "orders",
    key: { restaurantId: 1, table: 1, requestId: 1 },
    options: { unique: true, partialFilterExpression: { requestId: { $gt: "" } } },
  },
  {
    collection: "paymenttransactions",
    key: { restaurantId: 1, idempotencyKey: 1, status: 1 },
    options: { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } },
  },
  {
    collection: "tablesessions",
    key: { restaurantId: 1, "paymentHistory.idempotencyKey": 1 },
    options: {
      unique: true,
      partialFilterExpression: { "paymentHistory.idempotencyKey": { $gt: "" }, "paymentHistory.status": "PAID" },
    },
  },
  {
    collection: "customers",
    key: { restaurantId: 1, phone: 1 },
    options: { unique: true, partialFilterExpression: { phone: { $gt: "" }, isDeleted: false } },
  },
  {
    collection: "tables",
    key: { restaurantId: 1, tableNumber: 1 },
    options: { unique: true, partialFilterExpression: { isDeleted: false } },
    // The same key was built non-unique under an older spec; same name,
    // different options, so it must go first.
    dropFirst: "restaurantId_1_tableNumber_1",
  },
  {
    collection: "tableqrs",
    key: { tableId: 1, status: 1 },
    options: { unique: true, partialFilterExpression: { status: "ACTIVE", isDeleted: false } },
  },
];

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const db = mongoose.connection.db;
  let failed = 0;

  for (const g of GUARDS) {
    const col = db.collection(g.collection);
    try {
      if (g.dropFirst) {
        const existing = (await col.indexes()).find((i) => i.name === g.dropFirst);
        if (existing && !existing.unique) {
          await col.dropIndex(g.dropFirst);
          console.log(`${g.collection}: dropped non-unique ${g.dropFirst}`);
        }
      }
      const name = await col.createIndex(g.key, g.options);
      console.log(`${g.collection}: ${name} ok`);
    } catch (err) {
      failed += 1;
      console.error(`${g.collection}: FAILED - ${err.message}`);
    }
  }

  const sessions = db.collection("tablesessions");
  const names = (await sessions.indexes()).map((i) => i.name);
  if (names.includes("paymentHistory.idempotencyKey_1")) {
    await sessions.dropIndex("paymentHistory.idempotencyKey_1");
    console.log("tablesessions: dropped the old global paymentHistory.idempotencyKey_1");
  }

  await mongoose.disconnect();
  if (failed) process.exit(1);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
