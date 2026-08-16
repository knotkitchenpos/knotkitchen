const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    storeId: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: (v) => /^\d{6}$/.test(v),
        message: "Store ID must be exactly 6 digits",
      },
    },
    storeName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    ownerPhone: {
      type: String,
      required: true,
      validate: {
        validator: (v) => /^\d{10}$/.test(v),
        message: "Owner phone must be a 10-digit number",
      },
    },
    // Must stay in sync with knotkitchen-admin/backend/models/storeModel.js.
    // The admin portal can close a store temporarily or until a date, and those
    // values are written to this same shared collection.
    status: {
      type: String,
      enum: ["pending", "active", "suspended", "closed_temporarily", "closed_until", "deleted"],
      default: "pending",
    },
    closedUntil: { type: Date },
    closureReason: { type: String, default: "" },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

storeSchema.index({ storeName: 1 });
storeSchema.index({ ownerPhone: 1 });
storeSchema.index({ restaurantId: 1 });

module.exports = mongoose.model("Store", storeSchema);
