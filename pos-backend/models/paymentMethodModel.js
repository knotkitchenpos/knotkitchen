const mongoose = require("mongoose");

/**
 * Per-restaurant payment method configuration.
 * Determines which methods appear in the POS settle dialog
 * and which are accepted by payment links.
 */
const paymentMethodSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    method: {
      type: String,
      enum: ["CASH", "QR_CODE", "ONLINE", "PAYMENT_LINK", "CARD", "UPI", "WALLET", "SPLIT"],
      required: true,
    },
    isEnabled: { type: Boolean, default: true },
    // Outlet-specific UPI / QR config (dynamic QR id etc.)
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One config row per restaurant+outlet+method
paymentMethodSchema.index(
  { restaurantId: 1, outletId: 1, method: 1 },
  { unique: true }
);

module.exports = mongoose.model("PaymentMethod", paymentMethodSchema);