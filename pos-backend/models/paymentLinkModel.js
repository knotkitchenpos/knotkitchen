const mongoose = require("mongoose");

/**
 * Payment links — shareable URLs that settle a bill.
 * Customers open the link, pay via Razorpay, and the
 * transaction is recorded in PaymentTransaction + Bill.
 * Each link is scoped to a restaurant, never cross-tenant.
 */
const paymentLinkSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill", required: true },
    tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

    linkToken: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // snapshot at creation
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["ACTIVE", "PARTIALLY_PAID", "PAID", "EXPIRED", "CANCELLED"],
      default: "ACTIVE",
    },
    paidAmount: { type: Number, default: 0 },

    // Gateway
    gatewayOrderId: { type: String, default: "" },

    expiresAt: { type: Date, required: true },
    paidAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

paymentLinkSchema.index({ restaurantId: 1, createdAt: -1 });
paymentLinkSchema.index({ billId: 1 });
paymentLinkSchema.index({ status: 1 });

module.exports = mongoose.model("PaymentLink", paymentLinkSchema);