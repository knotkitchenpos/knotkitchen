const mongoose = require("mongoose");

/**
 * Customer database — referenced by Order.customerId and
 * TableSession.customerId (which previously dangled because this
 * model did not exist).
 */
const customerSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },

    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "", lowercase: true },

    // Optional auth-lite (for repeat customers via payment link)
    password: { type: String, select: false },
    isRegistered: { type: Boolean, default: false },

    // Loyalty / engagement
    tags: { type: [String], default: [] },
    preferences: { type: mongoose.Schema.Types.Mixed, default: {} },
    notes: { type: String, default: "" },

    // Spend tracking
    totalSpent: { type: Number, default: 0 },
    visitCount: { type: Number, default: 0 },
    lastVisitAt: { type: Date },

    address: {
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One customer per phone within a restaurant. `isDeleted` defaults to false
// on every document, so `isDeleted: false` covers them all; a partial index
// filter cannot use $ne (see orderModel).
customerSchema.index(
  { restaurantId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $gt: "" }, isDeleted: false } }
);
customerSchema.index({ restaurantId: 1, email: 1 }, { sparse: true });
customerSchema.index({ restaurantId: 1, isDeleted: 1 });

module.exports = mongoose.model("Customer", customerSchema);