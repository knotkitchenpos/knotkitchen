/**
 * 009 - Razorpay is gone; move stored settings off it.
 *
 * Every WebsiteSettings document carried `paymentGateways.activeGateway:
 * "razorpay"` because that was the schema default, not because anyone chose
 * it. The enum no longer accepts that value, and leaving it would make the
 * whole document fail validation on the next save of ANY unrelated field --
 * a very confusing way for the website editor to start rejecting logo uploads.
 *
 * Also drops the `razorpay` credential sub-document and the Razorpay-shaped
 * keyId / keySecret* fields from the gateways that remain.
 *
 * This was verified safe before it was written: production had zero payment
 * links, zero payments, zero orders carrying gateway identifiers, and no store
 * with Razorpay credentials configured. Nothing here can strand a real
 * payment.
 *
 * Raw driver, no Mongoose model - see 004 for why, and here for a second
 * reason: the model now REJECTS the very values this exists to remove, so
 * loading a document through it would fail before we could fix it.
 *
 * Idempotent - safe to re-run. A second run finds nothing left to change.
 */
const mongoose = require("mongoose");
const config = require("../config/config");

const run = async () => {
  await mongoose.connect(config.databaseURI);
  const db = mongoose.connection.db;

  const settings = db.collection("websitesettings");

  const movedActive = await settings.updateMany(
    { "paymentGateways.activeGateway": "razorpay" },
    { $set: { "paymentGateways.activeGateway": "cashfree" } },
  );

  const droppedBlock = await settings.updateMany(
    { "paymentGateways.razorpay": { $exists: true } },
    { $unset: { "paymentGateways.razorpay": "" } },
  );

  // The generic keyId/keySecret* trio belonged to Razorpay. Cashfree uses
  // clientId/clientSecret and PhonePe merchantId/saltKey, both untouched.
  const droppedFields = await settings.updateMany(
    {
      $or: [
        { "paymentGateways.cashfree.keyId": { $exists: true } },
        { "paymentGateways.phonepe.keyId": { $exists: true } },
      ],
    },
    {
      $unset: {
        "paymentGateways.cashfree.keyId": "",
        "paymentGateways.cashfree.keySecretMasked": "",
        "paymentGateways.cashfree.keySecretEncrypted": "",
        "paymentGateways.phonepe.keyId": "",
        "paymentGateways.phonepe.keySecretMasked": "",
        "paymentGateways.phonepe.keySecretEncrypted": "",
      },
    },
  );

  // Orders carried `paymentData.razorpay_*`. The field is now named for its
  // role rather than a provider, so any that exist are RENAMED, not dropped --
  // those are gateway receipts and worth keeping.
  const renamed = await db.collection("orders").updateMany(
    { "paymentData.razorpay_payment_id": { $exists: true } },
    {
      $rename: {
        "paymentData.razorpay_order_id": "paymentData.gatewayOrderId",
        "paymentData.razorpay_payment_id": "paymentData.gatewayPaymentId",
      },
    },
  );

  // A link that named RAZORPAY can no longer be captured. Expiring it says so
  // plainly rather than leaving the customer to find out at the payment step.
  const staleLinks = await db.collection("paymentlinks").updateMany(
    { gatewayName: "RAZORPAY", status: "ACTIVE" },
    { $set: { status: "EXPIRED" } },
  );

  console.log("activeGateway razorpay -> cashfree :", movedActive.modifiedCount);
  console.log("razorpay credential blocks dropped :", droppedBlock.modifiedCount);
  console.log("legacy keyId/keySecret fields gone :", droppedFields.modifiedCount);
  console.log("order paymentData renamed          :", renamed.modifiedCount);
  console.log("stale ACTIVE links expired         :", staleLinks.modifiedCount);

  const remaining = await settings.countDocuments({
    $or: [
      { "paymentGateways.activeGateway": "razorpay" },
      { "paymentGateways.razorpay": { $exists: true } },
    ],
  });
  console.log(
    remaining === 0
      ? "No Razorpay left in website settings."
      : `WARNING: ${remaining} settings document(s) still reference it.`,
  );

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
