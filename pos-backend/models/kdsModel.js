const mongoose = require("mongoose");

const kdsOrderItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    notes: { type: String, default: "" },
    modifiers: [{ name: String, price: Number }],
    status: {
      type: String,
      enum: ["queued", "preparing", "ready", "served", "cancelled"],
      default: "queued",
    },
    startedAt: Date,
    completedAt: Date,
    timeTakenSec: Number,
    chefId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const kdsOrderSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    station: { type: String, default: "Main Kitchen" },
    items: [kdsOrderItemSchema],
    priority: {
      type: String,
      enum: ["low", "normal", "high", "urgent"],
      default: "normal",
    },
    status: {
      type: String,
      enum: ["queued", "preparing", "ready", "served", "completed", "cancelled"],
      default: "queued",
    },
    colorCode: { type: String, default: "#60a5fa" },
    receivedAt: { type: Date, default: Date.now },
    startedAt: Date,
    completedAt: Date,
    estimatedPrepTime: { type: Number, default: 15 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

kdsOrderSchema.index({ restaurantId: 1, status: 1 });
kdsOrderSchema.index({ outletId: 1, status: 1 });
kdsOrderSchema.index({ station: 1, status: 1 });
kdsOrderSchema.index({ priority: 1, receivedAt: -1 });

module.exports = mongoose.model("KDSOrder", kdsOrderSchema);