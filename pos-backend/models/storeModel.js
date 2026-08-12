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
    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      default: "pending",
    },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

storeSchema.index({ storeName: 1 });
storeSchema.index({ ownerPhone: 1 });
storeSchema.index({ restaurantId: 1 });

module.exports = mongoose.model("Store", storeSchema);
