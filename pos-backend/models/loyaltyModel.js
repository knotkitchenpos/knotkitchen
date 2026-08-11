const mongoose = require("mongoose");

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true },
  email: { type: String, default: "" },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
  rewardPoints: { type: Number, default: 0 },
  membershipLevel: { type: String, enum: ["bronze", "silver", "gold", "platinum"], default: "bronze" },
  walletBalance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  orderCount: { type: Number, default: 0 },
  referralCode: { type: String, default: "" },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
  tags: [{ type: String }],
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

customerSchema.index({ restaurantId: 1, phone: 1 }, { unique: true });

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  description: { type: String, default: "" },
  type: { type: String, enum: ["percentage", "fixed", "free_item", "shipping"], required: true },
  value: { type: Number, required: true },
  minOrderAmount: { type: Number, default: 0 },
  maxDiscountAmount: { type: Number, default: 0 },
  usageLimit: { type: Number, default: 0 },
  usedCount: { type: Number, default: 0 },
  perCustomerLimit: { type: Number, default: 1 },
  validFrom: { type: Date, default: Date.now },
  validUntil: { type: Date },
  applicableOutlets: [{ type: mongoose.Schema.Types.ObjectId, ref: "Outlet" }],
  isActive: { type: Boolean, default: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

const giftCardSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  balance: { type: Number, required: true },
  initialBalance: { type: Number, required: true },
  recipientName: { type: String, default: "" },
  recipientEmail: { type: String, default: "" },
  senderName: { type: String, default: "" },
  message: { type: String, default: "" },
  expiryDate: Date,
  status: { type: String, enum: ["active", "used", "expired", "cancelled"], default: "active" },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

const walletTransactionSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
  type: { type: String, enum: ["credit", "debit"], required: true },
  amount: { type: Number, required: true },
  reason: { type: String, enum: ["cashback", "reward_redeem", "refund", "gift_card", "referral", "adjustment"], required: true },
  referenceId: { type: String, default: "" },
  description: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

walletTransactionSchema.index({ customerId: 1, createdAt: -1 });

module.exports = {
  // Named "LoyaltyCustomer" to avoid clashing with the primary Customer model
  // (customerModel.js) which is referenced by Order/TableSession. The export key
  // stays "Customer" so existing consumers (loyaltyRoute, analyticsRoute) work.
  Customer: mongoose.model("LoyaltyCustomer", customerSchema),
  Coupon: mongoose.model("Coupon", couponSchema),
  GiftCard: mongoose.model("GiftCard", giftCardSchema),
  WalletTransaction: mongoose.model("WalletTransaction", walletTransactionSchema),
};
