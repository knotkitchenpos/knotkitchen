const mongoose = require("mongoose");

const subscriptionPlanSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  monthlyPrice: { type: Number, required: true },
  annualPrice: { type: Number, default: 0 },
  features: { type: [String], default: [] },
  limits: {
    outlets: { type: Number, default: 1 },
    staff: { type: Number, default: 5 },
    menuItems: { type: Number, default: 100 },
    ordersPerMonth: { type: Number, default: 1000 },
  },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const subscriptionSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  planCode: { type: String, required: true },
  status: { type: String, enum: ["trial", "active", "past_due", "cancelled", "expired"], default: "trial" },
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  autoRenew: { type: Boolean, default: true },
  paymentGateway: { type: String, enum: ["razorpay", "stripe", "manual"], default: "razorpay" },
  gatewaySubscriptionId: { type: String, default: "" },
  couponCode: { type: String, default: "" },
  cancelAtPeriodEnd: { type: Boolean, default: false },
  failedPaymentCount: { type: Number, default: 0 },
}, { timestamps: true });

subscriptionSchema.index({ restaurantId: 1 }, { unique: true });

const invoiceSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  invoiceNumber: { type: String, required: true, unique: true },
  planCode: { type: String, required: true },
  amount: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  totalAmount: { type: Number, required: true },
  taxId: { type: String, default: "" }, // GST number
  currency: { type: String, default: "INR" },
  status: { type: String, enum: ["draft", "sent", "paid", "overdue", "failed", "void"], default: "draft" },
  paymentMethod: { type: String, default: "" },
  paymentReference: { type: String, default: "" },
  periodStart: Date,
  periodEnd: Date,
  dueDate: Date,
  paidAt: Date,
}, { timestamps: true });

invoiceSchema.index({ restaurantId: 1, createdAt: -1 });

const paymentSchema = new mongoose.Schema({
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
  amount: { type: Number, required: true },
  currency: { type: String, default: "INR" },
  method: { type: String, enum: ["card", "upi", "netbanking", "wallet", "manual"], default: "card" },
  gateway: { type: String, enum: ["razorpay", "stripe", "manual"], default: "manual" },
  status: { type: String, enum: ["pending", "success", "failed", "refunded"], default: "pending" },
  gatewayPaymentId: { type: String, default: "" },
  failureReason: { type: String, default: "" },
}, { timestamps: true });

module.exports = {
  SubscriptionPlan: mongoose.model("SubscriptionPlan", subscriptionPlanSchema),
  Subscription: mongoose.model("Subscription", subscriptionSchema),
  Invoice: mongoose.model("Invoice", invoiceSchema),
  SubscriptionPayment: mongoose.model("SubscriptionPayment", paymentSchema),
};