/**
 * 010 - Scope the table-session payment idempotency index to the restaurant.
 *
 * `paymentHistory.idempotencyKey` was unique across ALL restaurants. The key
 * is chosen by the till (`pay-<sessionId>-1`, or the gateway's transaction
 * id), so two stores could only collide by accident, but an accident would
 * have refused a genuine payment with a duplicate-key error. Every other
 * idempotency index in the app is `{ restaurantId, key }`; this one now is.
 *
 * Raw driver, no Mongoose model: the deployed model already declares the new
 * index (autoIndex creates it on boot), and this only drops the old one.
 * Deploy first, then run.
 *
 * Idempotent - safe to re-run.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const OLD = "paymentHistory.idempotencyKey_1";
const NEW = "restaurantId_1_paymentHistory.idempotencyKey_1";

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const col = mongoose.connection.db.collection("tablesessions");
  const names = (await col.indexes()).map((i) => i.name);

  if (!names.includes(NEW)) {
    await col.createIndex(
      { restaurantId: 1, "paymentHistory.idempotencyKey": 1 },
      {
        unique: true,
        partialFilterExpression: { "paymentHistory.idempotencyKey": { $ne: "" }, "paymentHistory.status": "PAID" },
      },
    );
    console.log("created", NEW);
  } else {
    console.log("already present", NEW);
  }

  if (names.includes(OLD)) {
    await col.dropIndex(OLD);
    console.log("dropped", OLD);
  } else {
    console.log("already gone", OLD);
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
