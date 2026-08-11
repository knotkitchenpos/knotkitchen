const mongoose = require("mongoose");

const tableSchema = new mongoose.Schema(
  {
    tableNumber: {
      type: Number,
      required: true,
      min: [1, "Table number must be at least 1"],
    },
    capacity: {
      type: Number,
      default: 4,
      min: [1, "Capacity must be at least 1 customer"],
      max: [100, "Capacity cannot exceed 100 customers"],
      validate: {
        validator: Number.isInteger,
        message: "Capacity must be an integer",
      },
    },
    currentOccupancy: {
      type: Number,
      default: 0,
      min: [0, "Current occupancy cannot be negative"],
      validate: {
        validator: function (v) {
          if (!Number.isInteger(v)) return false;
          // Cross-field constraint: occupancy can never exceed table capacity
          return this.capacity == null || v <= this.capacity;
        },
        message: "Current occupancy cannot exceed table capacity",
      },
    },
    status: {
      type: String,
      enum: ["available", "occupied", "reserved", "cleaning"],
      default: "available",
    },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    currentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    zone: { type: String, default: "Main Hall" },
    // QR ordering
    qrCode: { type: String, default: "" },
    qrToken: { type: String, default: "" },
    qrEnabled: { type: Boolean, default: true },
    // Waiter calling
    waiterCallActive: { type: Boolean, default: false },
    waiterCallRequestedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true, partialFilterExpression: { isDeleted: { $ne: true } } });
tableSchema.index({ restaurantId: 1, outletId: 1, tableNumber: 1 });
tableSchema.index({ restaurantId: 1, outletId: 1, tableNumber: 1, status: 1 });
tableSchema.index({ qrToken: 1 }, { unique: true, sparse: true });
tableSchema.index({ createdBy: 1 });

module.exports = mongoose.model("Table", tableSchema);