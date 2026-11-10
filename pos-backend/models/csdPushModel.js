const mongoose = require("mongoose");

/**
 * Web push for CSD (new WhatsApp messages reach an agent's phone or computer
 * even with CSD closed). One row per device a staff member switched it on for;
 * switching it off, signing out of the browser's push, or the push service
 * saying the device is gone (404/410) removes the row.
 */
const subscriptionSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true, index: true },
    // The push service URL for this device (FCM, Apple, Mozilla…): unique per device.
    endpoint: { type: String, required: true, unique: true, maxlength: 2000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    userAgent: { type: String, default: "", maxlength: 300 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/**
 * The server's VAPID key pair, made on first use and kept here so every API
 * instance and restart signs with the same key (a new key would orphan every
 * device that subscribed with the old one). WEB_PUSH_PUBLIC_KEY /
 * WEB_PUSH_PRIVATE_KEY in the environment take precedence if set.
 */
const vapidSchema = new mongoose.Schema(
  {
    _id: { type: String },
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true },
  },
  { timestamps: true }
);

const CsdPushSubscription = mongoose.model("CsdPushSubscription", subscriptionSchema);
const WebPushKey = mongoose.model("WebPushKey", vapidSchema);

module.exports = { CsdPushSubscription, WebPushKey };
