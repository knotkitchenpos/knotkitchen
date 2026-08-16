const mongoose = require("mongoose");

/**
 * WebsiteSettings — storefront configuration, ONE per store.
 *
 * ⚠️  Must stay in sync with pos-backend/models/websiteSettingsModel.js.
 * Both apps read/write the same shared collection: the admin portal creates
 * the document when a store is registered, and the POS lets the restaurant
 * edit it. This file is intentionally a lean mirror — it declares the fields
 * the admin portal needs to write plus `strict: false` so it never drops
 * fields the POS owns.
 *
 * See the POS copy for full field documentation.
 */
const websiteSettingsSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, unique: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, default: null },

    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    subdomain: { type: String, default: "" },
    customDomain: { type: String, default: "" },

    enabled: { type: Boolean, default: true },
    disabledMessage: {
      type: String,
      default: "Online ordering is currently unavailable. Please try again later.",
    },

    displayName: { type: String, default: "" },
    branding: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    theme: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    ordering: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    contact: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    offers: { type: Array, default: [] },
    openingHours: { type: Array, default: [] },
    useBusinessHours: { type: Boolean, default: false },

    status: { type: String, enum: ["draft", "published"], default: "published" },
    draft: { type: mongoose.Schema.Types.Mixed, default: null },
    publishedAt: { type: Date, default: Date.now },
    version: { type: Number, default: 1 },

    isDeleted: { type: Boolean, default: false },
  },
  // strict:false — the POS owns the detailed sub-schemas; never strip them.
  { timestamps: true, strict: false }
);

module.exports =
  mongoose.models.WebsiteSettings || mongoose.model("WebsiteSettings", websiteSettingsSchema);
