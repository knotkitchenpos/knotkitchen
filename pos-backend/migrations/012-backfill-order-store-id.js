/**
 * 012 - stamp each order with its store's storeId.
 *
 * Only website orders used to carry storeId; POS, QR, table-session and
 * marketplace orders kept the "" default, so every CSD reader that keys orders
 * on storeId (the store page's customers and export, the order summary, order
 * search, the order detail's store name) saw website orders only. New orders
 * are stamped by orderModel's pre("validate") hook; this fills in the rest.
 *
 * Raw driver, no Mongoose model. Deploy first, then run. Idempotent: only
 * orders with a blank or missing storeId are touched.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const db = mongoose.connection;
  const orders = db.collection("orders");
  const blank = { $or: [{ storeId: "" }, { storeId: null }, { storeId: { $exists: false } }] };

  let stamped = 0;
  const restaurants = db.collection("restaurants").find({ storeId: { $gt: "" } }, { projection: { storeId: 1 } });
  for await (const r of restaurants) {
    const res = await orders.updateMany({ restaurantId: r._id, ...blank }, { $set: { storeId: r.storeId } });
    stamped += res.modifiedCount;
  }
  console.log(`storeId: stamped on ${stamped} order(s).`);

  const left = await orders.countDocuments(blank);
  console.log(left === 0 ? "Nothing left to change." : `${left} order(s) still blank (no restaurant, or one without a storeId).`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
