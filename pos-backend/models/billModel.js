const mongoose = require("mongoose");

const billSchema = new mongoose.Schema(
  {
    billNumber: { type: String, required: true, unique: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    tableSessionId: { type: mongoose.Schema.Types.ObjectId, ref: "TableSession" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
    customerDetails: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      guests: { type: Number, default: 1 },
    },
    bills: {
      subtotal: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
      discount: { type: Number, default: 0 },
      charges: { type: Number, default: 0 },
      totalWithTax: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["PENDING", "PARTIAL", "PAID", "VOID", "CLOSED"],
      default: "PENDING",
    },
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    requestedAt: Date,
    settledAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

billSchema.index({ restaurantId: 1, createdAt: -1 });
billSchema.index({ tableSessionId: 1 }, { unique: true, sparse: true });
billSchema.index({ customerId: 1 });

module.exports = mongoose.model("Bill", billSchema);