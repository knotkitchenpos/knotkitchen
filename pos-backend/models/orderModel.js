const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1 },
  price: { type: Number, required: true },
  total: { type: Number, required: true },
  modifiers: [{ name: String, price: Number }],
  note: { type: String, default: "" },
  status: {
    type: String,
    enum: ["pending", "preparing", "ready", "served", "cancelled", "refunded"],
    default: "pending",
  },
  cancelledAt: Date,
  cancelReason: String,
});

const paymentSchema = new mongoose.Schema({
  method: { type: String, enum: ["cash", "card", "upi", "wallet", "online", "split"], default: "cash" },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ["pending", "paid", "failed", "refunded"], default: "pending" },
  transactionId: { type: String, default: "" },
  refund: {
    amount: { type: Number, default: 0 },
    reason: { type: String, default: "" },
    refundedAt: Date,
  },
});

const orderSchema = new mongoose.Schema({
  customerDetails: {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    guests: { type: Number, default: 1 },
  },
  orderType: {
    type: String,
    enum: ["dine-in", "takeaway", "delivery", "online", "marketplace", "collection"],
    default: "dine-in",
  },
  deliveryAddress: {
    line1: String, line2: String, city: String, postalCode: String,
    instructions: String,
  },
  orderStatus: { type: String, required: true },
  marketplace: { type: String, enum: ["Swiggy", "Zomato", "Manual", ""] },
  marketplaceOrderId: { type: String, default: "" },
  orderDate: { type: Date, default: Date.now },
  bills: {
    subtotal: { type: Number, default: 0 },
    total: { type: Number, required: true },
    tax: { type: Number, required: true },
    totalWithTax: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    packagingFee: { type: Number, default: 0 },
  },
  items: [orderItemSchema],
  table: { type: mongoose.Schema.Types.ObjectId, ref: "Table" },
  tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
  requestId: { type: String, default: "" },
  restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
  outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  couponCode: { type: String, default: "" },
  tips: { type: Number, default: 0 },
  payments: [paymentSchema],
  isSplit: { type: Boolean, default: false },
  splitDetails: [{
    label: String,
    amount: Number,
    items: [String], // item ids or names
    paymentMethod: String,
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    paidAt: Date,
  }],
  refunds: [{
    amount: Number,
    reason: String,
    items: [String],
    refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    refundedAt: { type: Date, default: Date.now },
  }],
  timeline: [{
    status: String,
    timestamp: { type: Date, default: Date.now },
    user: String,
  }],
  isOffline: { type: Boolean, default: false },
  syncStatus: { type: String, enum: ["synced", "pending", "failed"], default: "synced" },
  paymentMethod: { type: String, default: "" },
  paymentData: { razorpay_order_id: String, razorpay_payment_id: String },
  // Customer-created (QR) orders have no POS user — createdBy is null
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ marketplace: 1, orderDate: -1 });
orderSchema.index({ restaurantId: 1, createdAt: -1 });
orderSchema.index({ "customerDetails.phone": 1 });

// QR double-fire guard: one kitchen order per requestId per table
orderSchema.index(
  { restaurantId: 1, table: 1, requestId: 1 },
  { unique: true, partialFilterExpression: { requestId: { $ne: "" } } }
);
orderSchema.index({ tableSessionId: 1 });

module.exports = mongoose.model("Order", orderSchema);
