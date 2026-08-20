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
    taxId: { type: String, default: "" }, // GST Number (optional)
    currency: { type: String, default: "INR" },
    timezone: { type: String, default: "Asia/Kolkata" },
    address: { type: addressSchema, default: () => ({}) },
    branding: { type: brandingSchema, default: () => ({}) },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    storeId: { type: String, unique: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "ProductId" },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    subscription: {
      plan: { type: String, default: "free" },
      status: { type: String, default: "trial" },
      trialEndsAt: { type: Date },
      currentPeriodEndsAt: { type: Date },
    },

    // Module 7 §1 — Extended Store Properties
    ownerName: { type: String, default: "" },
    ownerPhone: { type: String, default: "" },
    contactPersonPhone: { type: String, default: "" },
    ownerEmail: { type: String, default: "" },
    fssaiNumber: { type: String, default: "" },
    mapsLink: { type: String, default: "" },

    // Module 7 §2 — Hashed Protection PIN (Default "8796")
    // Stored as bcrypt hash, never plaintext!
    securityPin: { type: String, default: "" },

    // Module 7 §3 — POS Settings & Receipt/Bill Customization
    posSettings: {
      autoPrintReceipt: { type: Boolean, default: true },
      autoEBill: { type: Boolean, default: false },
      customMessage: { type: String, default: "Thank you for visiting us!" },
      websiteLink: { type: String, default: "" },
    },

    // Module 7 §4 — Order Type Toggles
    orderTypeToggles: {
      collection: { type: Boolean, default: true },
      delivery: { type: Boolean, default: true },
      table: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);


restaurantSchema.index({ ownerId: 1 });
restaurantSchema.index({ productId: 1 });
restaurantSchema.index({ "subscription.plan": 1 });

module.exports = mongoose.model("Restaurant", restaurantSchema);