const mongoose = require("mongoose");

/**
 * One restaurant referred by another (owner, 2026-11-17). Recorded when CSD
 * onboards the new store with the referrer's code; when the new store's first
 * top-up is paid, both stores get wallet credit once (services/referrals.js).
 */
const referralSchema = new mongoose.Schema(
  {
    referrerStoreId: { type: String, required: true, index: true },
    referrerRestaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    // A store can be referred only once.
    referredStoreId: { type: String, required: true, unique: true },
    referredRestaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, unique: true },
    status: { type: String, enum: ["PENDING", "REWARDING", "REWARDED"], default: "PENDING", index: true },
    // Each store's credit, fixed when it was paid (CSD can change the amount later).
    rewardPaise: { type: Number, default: 0 },
    rewardedAt: { type: Date, default: null },
    recordedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Referral", referralSchema);
