const mongoose = require("mongoose");

/**
 * Standalone payment ledger — one row per payment attempt.
 * Fixes the "payments embedded only inside Order/TableSession"
 * reporting gap. Records both POS-side and payment-link payments.
 */
const paymentTransactionSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
    paymentLinkId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentLink" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

    method: {
      type: String,
      enum: ["CASH", "QR_CODE", "ONLINE", "PAYMENT_LINK", "CARD", "UPI", "WALLET", "SPLIT"],
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED"],
      default: "PENDING",
    },

    // Gateway fields
    provider: { type: String, default: "CASHFREE" },
    transactionId: { type: String, default: "" },
    gatewayOrderId: { type: String, default: "" },
    gatewayPaymentId: { type: String, default: "" },
    gatewayResponse: { type: mongoose.Schema.Types.Mixed, default: {} },

    idempotencyKey: { type: String, default: "" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Dedupe guarantee: one successful transaction per idempotency key per tenant
paymentTransactionSchema.index(
  { restaurantId: 1, idempotencyKey: 1, status: 1 },
  // `$gt: ""`, never `$ne`: a partial index filter cannot use $ne (see orderModel).
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: "" } } }
);
paymentTransactionSchema.index({ billId: 1 });
paymentTransactionSchema.index({ tableSessionId: 1 });
paymentTransactionSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("PaymentTransaction", paymentTransactionSchema);