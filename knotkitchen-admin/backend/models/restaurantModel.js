const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    country: { type: String, default: "" },
    lat: { type: Number },
    lng: { type: Number },
  },
  { _id: false }
);

const brandingSchema = new mongoose.Schema(
  {
    logo: { type: String, default: "" },
    primaryColor: { type: String, default: "#5b45b0" },
    secondaryColor: { type: String, default: "" },
    accentColor: { type: String, default: "" },
    customDomain: { type: String, default: "" },
  },
  { _id: false }
);

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    legalName: { type: String, default: "" },
    registrationNumber: { type: String, default: "" },
    taxId: { type: String, default: "" },
    currency: { type: String, default: "INR" },
    timezone: { type: String, default: "Asia/Kolkata" },
    address: { type: addressSchema, default: () => ({}) },
    branding: { type: brandingSchema, default: () => ({}) },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    storeId: { type: String, unique: true, index: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    subscription: {
      plan: { type: String, default: "free" },
      status: { type: String, default: "trial" },
      trialEndsAt: { type: Date },
      currentPeriodEndsAt: { type: Date },
    },
  },
  { timestamps: true }
);

restaurantSchema.index({ ownerId: 1 });
restaurantSchema.index({ "subscription.plan": 1 });

// Important: model name must match the POS system's model so they share the collection
module.exports = mongoose.models.Restaurant || mongoose.model("Restaurant", restaurantSchema);