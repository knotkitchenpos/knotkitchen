const mongoose = require("mongoose");

/**
 * Phone alerts for the Partners dashboard (owner, 2026-11-13): one row per
 * device an owner switched alerts on for. Switching it off, or the push
 * service saying the device is gone (404/410), removes the row.
 */
const partnerPushSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerAccount", required: true, index: true },
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
 * When an alert of one kind about one store (or one dish) was last sent to
 * a partner, so a flapping lock or a busy refund day is one alert, not ten.
 * Rows expire by themselves after a day.
 */
const partnerAlertMarkSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  key: { type: String, required: true },
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});
partnerAlertMarkSchema.index({ partnerId: 1, key: 1 }, { unique: true });

module.exports = {
  PartnerPushSubscription: mongoose.model("PartnerPushSubscription", partnerPushSchema),
  PartnerAlertMark: mongoose.model("PartnerAlertMark", partnerAlertMarkSchema),
};
