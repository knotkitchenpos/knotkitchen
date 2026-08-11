const mongoose = require("mongoose");

const tableSchema = new mongoose.Schema(
  {
    tableNumber: { type: Number, required: true },
    capacity: { type: Number, default: 4 },
    status: { type: String, enum: ["available", "occupied", "reserved", "cleaning"], default: "available" },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    currentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    zone: { type: String, default: "Main Hall" },
    qrCode: { type: String, default: "" },
    qrToken: { type: String, default: "" },
    qrEnabled: { type: Boolean, default: true },
    waiterCallActive: { type: Boolean, default: false },
    waiterCallRequestedAt: Date,
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tableSchema.index({ restaurantId: 1, tableNumber: 1 });
tableSchema.index({ qrToken: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.Table || mongoose.model("Table", tableSchema);