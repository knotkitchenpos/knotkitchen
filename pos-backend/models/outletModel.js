const mongoose = require("mongoose");

const outletSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true },
    code: { type: String, required: true }, // e.g. "DEL-01"
    address: {
      line1: { type: String, default: "" },
      line2: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      postalCode: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    timezone: { type: String, default: "Asia/Kolkata" },
    openingHours: {
      monday: { open: String, close: String, closed: { type: Boolean, default: false } },
      tuesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      wednesday: { open: String, close: String, closed: { type: Boolean, default: false } },
      thursday: { open: String, close: String, closed: { type: Boolean, default: false } },
      friday: { open: String, close: String, closed: { type: Boolean, default: false } },
      saturday: { open: String, close: String, closed: { type: Boolean, default: false } },
      sunday: { open: String, close: String, closed: { type: Boolean, default: false } },
    },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

outletSchema.index({ restaurantId: 1, code: 1 }, { unique: true });
outletSchema.index({ restaurantId: 1 });

module.exports = mongoose.model("Outlet", outletSchema);