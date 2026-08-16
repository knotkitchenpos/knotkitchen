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
    // "addon" = optional extras group, "choice" = pick-one/pick-many group.
    groupType: { type: String, enum: ["addon", "choice"], default: "addon" },
    options: [modifierOptionSchema],
});


const variantSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g. Small, Medium, Large
    price: { type: Number, required: true },
    isAvailable: { type: Boolean, default: true },
});

const addonSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g. Extra Cheese, Extra Sauce
    price: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: true },
});

const priceRuleSchema = new mongoose.Schema({
    name: { type: String, required: true }, // e.g. Happy Hour, Weekend Special
    price: { type: Number, required: true },
    startTime: { type: String, default: "00:00" }, // HH:mm
    endTime: { type: String, default: "23:59" },   // HH:mm
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] }, // 0=Sun ... 6=Sat
    isActive: { type: Boolean, default: true },
});

const scheduleSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    startTime: { type: String, default: "09:00" }, // HH:mm
    endTime: { type: String, default: "23:00" },   // HH:mm
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] }, // 0=Sun ... 6=Sat
});

const menuItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    /**
     * Optional subcategory grouping inside a category (§POS redesign).
     * Empty string means the item lives directly under the category with no
     * subcategory. This is additive — existing items keep working unchanged.
     */
    subcategory: { type: String, default: "" },
    isAvailable: { type: Boolean, default: true },
    description: { type: String, default: "" },

    // Legacy free-form image URL. Kept for backwards compatibility with all
    // existing menus/imports — the storefront falls back to it when no
    // media library asset is linked.
    image: { type: String, default: "" },

    /**
     * Media library reference (§7). Products point at a MediaAsset instead of
     * duplicating an upload. imageUrl/imageThumbnailUrl are denormalized
     * copies so the storefront can render without populating every asset.
     */
    imageId: { type: mongoose.Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    imageUrl: { type: String, default: "" },
    imageThumbnailUrl: { type: String, default: "" },
    imageAlt: { type: String, default: "" },

    // Storefront merchandising
    discountPrice: { type: Number, default: null }, // strike-through pricing
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
    comboItems: { type: [String], default: [] }, // names of included items

    // Pricing rules (time/day based discounted or special prices)
    priceRules: { type: [priceRuleSchema], default: [] },

    // Availability scheduling
    schedule: { type: scheduleSchema, default: () => ({}) },

    // Nutrition & allergens
    nutrition: { type: mongoose.Schema.Types.Mixed, default: {} }, // calories, protein, carbs, fat
    allergens: { type: [String], default: [] }, // gluten, dairy, nuts, etc.
    isVegetarian: { type: Boolean, default: false },
});

const versionSnapshotSchema = new mongoose.Schema({
    version: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: Date.now },
}, { _id: false });

const menuSchema = new mongoose.Schema({
    name: { type: String, required: true },
    bgColor: { type: String, default: "#5b45b0" },
    icon: { type: String, default: "🍽️" },
    items: [menuItemSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    // Multi-tenant support
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    isDeleted: { type: Boolean, default: false },

    // Time-based menu availability
    schedule: { type: scheduleSchema, default: () => ({}) },

    // Menu versioning & publishing
    version: { type: Number, default: 1 },
    published: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: true },
    publishedAt: { type: Date, default: null },
    versionHistory: { type: [versionSnapshotSchema], default: [] },
}, { timestamps: true });

menuSchema.index({ restaurantId: 1, isDeleted: 1 });
menuSchema.index({ restaurantId: 1, published: 1 });

module.exports = mongoose.model("Menu", menuSchema);