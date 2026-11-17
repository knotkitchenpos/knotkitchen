const mongoose = require("mongoose");

/**
 * Every change to a customer's loyalty points (owner, 2026-11-17), so a
 * balance can always be explained. `key` makes each change happen once:
 * earn:<orderId>, earn-s:<sessionId>, redeem:<orderId>, reverse:<orderId>,
 * return:<orderId>, expire:<customerId>:<date>.
 */
const loyaltyEntrySchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    kind: { type: String, enum: ["EARN", "REDEEM", "REVERSE", "RETURN", "EXPIRE"], required: true },
    // Signed: + earned or given back, - redeemed, taken back or expired.
    points: { type: Number, required: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    tableSessionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    billAmount: { type: Number, default: 0 },
    key: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

loyaltyEntrySchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("LoyaltyEntry", loyaltyEntrySchema);
