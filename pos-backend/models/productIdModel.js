const mongoose = require("mongoose");

const productIdSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, default: "" },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "EXPIRED", "CONSUMED"],
      default: "ACTIVE",
    },
    allowsRegistration: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isAssigned: { type: Boolean, default: false },
    assignedRestaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    assignedAt: Date,
    notes: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Backward-compat alias so legacy code using `code` still works
productIdSchema.virtual("code").get(function () {
  return this.productId;
});

productIdSchema.index({ productId: 1 }, { unique: true });
productIdSchema.index({ isActive: 1, allowsRegistration: 1, isAssigned: 1 });
productIdSchema.index({ status: 1 });

module.exports = mongoose.model("ProductId", productIdSchema);