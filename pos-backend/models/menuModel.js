const mongoose = require("mongoose");

const modifierOptionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
});

const modifierGroupSchema = new mongoose.Schema({
    name: { type: String, required: true },
    required: { type: Boolean, default: false },
    minSelections: { type: Number, default: 0 },
    maxSelections: { type: Number, default: 1 },
    groupType: { type: String, enum: ["addon", "choice"], default: "addon" },
    options: [modifierOptionSchema],
});

const variantSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    isAvailable: { type: Boolean, default: true },
});

const addonSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
});

const priceRuleSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    startTime: { type: String, default: "00:00" },
    endTime: { type: String, default: "23:59" },
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    isActive: { type: Boolean, default: true },
});

const scheduleSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    startTime: { type: String, default: "09:00" },
    endTime: { type: String, default: "23:00" },
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
});

const dispatchTypeSchema = new mongoose.Schema(
  {
    collection: { type: Boolean, default: true },
    delivery: { type: Boolean, default: true },
    table: { type: Boolean, default: true },
  },
  { _id: false }
);

const channelPricesSchema = new mongoose.Schema(
  {
    posCollection: { type: Number, default: 0 },
    posDelivery: { type: Number, default: 0 },
    posTable: { type: Number, default: 0 },
    websiteCollection: { type: Number, default: 0 },
    websiteDelivery: { type: Number, default: 0 },
    websiteTable: { type: Number, default: 0 },
  },
  { _id: false }
);

const subcategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    dispatchType: { type: dispatchTypeSchema, default: () => ({ collection: true, delivery: true, table: true }) },
    bgColor: { type: String, default: "#0249fd" },
    textColor: { type: String, default: "#ffffff" },
  },
  { timestamps: true }
);

const menuItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    subcategory: { type: String, default: "" },
    isAvailable: { type: Boolean, default: true },
    description: { type: String, default: "" },
    dispatchType: { type: dispatchTypeSchema, default: () => ({ collection: true, delivery: true, table: true }) },
    bgColor: { type: String, default: "#0249fd" },
    textColor: { type: String, default: "#ffffff" },

    // Module 2 §3 & §4: Same price vs Separate Channel Prices
    samePrice: { type: Boolean, default: true },
    channelPrices: { type: channelPricesSchema, default: () => ({}) },

    // Module 2 §6: Veg / Non-Veg
    isVegetarian: { type: Boolean, default: true },

    // Module 2 §7: Display (System / Website / Both)
    displayTarget: { type: String, enum: ["both", "system", "website"], default: "both" },

    // Product Image
    image: { type: String, default: "" },
    imageId: { type: mongoose.Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    imageUrl: { type: String, default: "" },
    imageThumbnailUrl: { type: String, default: "" },
    imageAlt: { type: String, default: "" },

    // Storefront merchandising
    discountPrice: { type: Number, default: null },
    isFeatured: { type: Boolean, default: false },
    showOnWebsite: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },

    // Variants (size-based pricing)
    variants: { type: [variantSchema], default: [] },

    // Add-ons
    addons: { type: [addonSchema], default: [] },

    // Modifier groups
    modifierGroups: { type: [modifierGroupSchema], default: [] },

    // Combo meal
    isCombo: { type: Boolean, default: false },
    comboDescription: { type: String, default: "" },
    comboItems: { type: [String], default: [] },

    // Pricing rules
    priceRules: { type: [priceRuleSchema], default: [] },

    // Availability scheduling
    schedule: { type: scheduleSchema, default: () => ({}) },

    // Nutrition & allergens
    nutrition: { type: mongoose.Schema.Types.Mixed, default: {} },
    allergens: { type: [String], default: [] },
});

const versionSnapshotSchema = new mongoose.Schema({
    version: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: Date.now },
}, { _id: false });

const menuSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: "" },
    dispatchType: { type: dispatchTypeSchema, default: () => ({ collection: true, delivery: true, table: true }) },
    bgColor: { type: String, default: "#5b45b0" },
    icon: { type: String, default: "🍽️" },
    items: [menuItemSchema],
    subcategories: [subcategorySchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    isDeleted: { type: Boolean, default: false },

    schedule: { type: scheduleSchema, default: () => ({}) },

    version: { type: Number, default: 1 },
    published: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null },
    versionHistory: { type: [versionSnapshotSchema], default: [] },

    hasPublishedToSystem: { type: Boolean, default: false },
    lastPublishedToSystemAt: { type: Date, default: null },
    systemVersion: { type: Number, default: 0 },
    systemSnapshot: {
      name: { type: String },
      items: [menuItemSchema],
    },

    // Display order for Manage Menu / storefront category chips. Older
    // records default to 0; the reorder endpoint stamps a fresh value on
    // every menu returned by the caller so ties break deterministically.
    // The `getMenus` projection sorts by this ascending, falling back on
    // createdAt when several menus share the default 0.
    sortOrder: { type: Number, default: 0 },

    hasPublishedToWebsite: { type: Boolean, default: false },
    lastPublishedToWebsiteAt: { type: Date, default: null },
    websiteVersion: { type: Number, default: 0 },
    websiteSnapshot: {
      name: { type: String },
      items: [menuItemSchema],
    },
}, { timestamps: true });

menuSchema.index({ restaurantId: 1, isDeleted: 1 });
menuSchema.index({ restaurantId: 1, published: 1 });

module.exports = mongoose.model("Menu", menuSchema);
