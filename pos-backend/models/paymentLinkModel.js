const mongoose = require("mongoose");

/**
 * Payment links — shareable URLs that settle a bill/order.
 * Customers open the link, pay by card/UPI/netbanking, and the
 * transaction is recorded in PaymentTransaction + Bill + Order.
 * Each link is scoped to a restaurant, never cross-tenant.
 */
const paymentLinkSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    billId: { type: mongoose.Schema.Types.ObjectId, ref: "Bill" },
    tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    customerPhone: { type: String, default: "" },

    linkToken: { type: String, required: true, unique: true },
    amount: { type: Number, required: true }, // snapshot at creation, calculated by backend
    currency: { type: String, default: "INR" },

    status: {
      type: String,
      enum: ["ACTIVE", "PARTIALLY_PAID", "PAID", "EXPIRED", "CANCELLED"],
      default: "ACTIVE",
    },
    paidAmount: { type: Number, default: 0 },

    // Gateway
    gatewayName: { type: String, default: "CASHFREE" },
    gatewayOrderId: { type: String, default: "" },
    // Cashfree gives the browser a payment_session_id rather than an order
    // id plus a public key, and the SDK has to be told sandbox vs
    // production or it silently fails to open. Both live here because the
    // public link page is anonymous and cannot resolve the tenant itself.
    // Neither is a secret.
    paymentSessionId: { type: String, default: "" },
    gatewayMode: { type: String, default: "" },

    expiresAt: { type: Date, required: true },
    paidAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

paymentLinkSchema.index({ restaurantId: 1, createdAt: -1 });
paymentLinkSchema.index({ billId: 1 });
paymentLinkSchema.index({ orderId: 1 });
paymentLinkSchema.index({ status: 1 });

module.exports = mongoose.model("PaymentLink", paymentLinkSchema);
