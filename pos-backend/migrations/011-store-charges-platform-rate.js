/**
 * 011 - store charge rows back onto the platform per-order rate, and the two
 * retired fields dropped.
 *
 * CsdStoreCharges once defaulted onlinePaidOrderCharge to 9 and materialised
 * that on every row it created. The field now means "a negotiated rate", with
 * null = the platform amount, so a copied 9 silently pins the store to ₹9
 * whatever CSD sets the platform charge to later. Only rows still holding 9
 * that nobody ever edited (no history entry for the field) are reset; a 9 CSD
 * chose deliberately is kept.
 *
 * gstPercent and monthlySubscription are no longer on the schema (GST and the
 * plan price live in PlatformBillingConfig / planPrices) and are unset.
 *
 * Raw driver, no Mongoose model. Deploy first, then run. Idempotent.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const charges = mongoose.connection.collection("csdstorecharges");

  const copiedDefault = {
    onlinePaidOrderCharge: 9,
    history: { $not: { $elemMatch: { field: "onlinePaidOrderCharge" } } },
  };
  const retired = { $or: [{ gstPercent: { $exists: true } }, { monthlySubscription: { $exists: true } }] };

  const kept = await charges.countDocuments({ onlinePaidOrderCharge: 9, "history.field": "onlinePaidOrderCharge" });
  const rate = await charges.updateMany(copiedDefault, { $set: { onlinePaidOrderCharge: null } });
  console.log(`onlinePaidOrderCharge: ${rate.modifiedCount} row(s) set to null (platform rate); ${kept} edited ₹9 row(s) kept.`);

  const dropped = await charges.updateMany(retired, { $unset: { gstPercent: "", monthlySubscription: "" } });
  console.log(`gstPercent / monthlySubscription: unset on ${dropped.modifiedCount} row(s).`);

  const left = await charges.countDocuments({ $or: [copiedDefault, retired] });
  console.log(left === 0 ? "Nothing left to change." : `WARNING: ${left} row(s) still match.`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
