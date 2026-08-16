const mongoose = require("mongoose");

/**
 * WebsiteSettings — one document per Store. This is the "storefront config"
 * that powers the public customer website.
 *
 * Why a separate collection instead of embedding into Store?
 *  - models/storeModel.js is a SHARED collection kept in sync with
 *    knotkitchen-admin/backend/models/storeModel.js. Adding storefront fields
 *    there would force both codebases to stay in lockstep.
 *  - Storefront config is read on every public page load; keeping it isolated
 *    lets us index/cache it independently of the admin store records.
 *
 * Identity model (see §17 of the spec):
 *    storeId      = permanent internal identifier (never changes)
 *    slug         = public identifier (human readable, may change)
 *    subdomain    = future: abc-restaurant.knotkitchen.com
 *    customDomain = future: www.abcrestaurant.com
 */

// Only these fonts may ever be selected. Prevents arbitrary CSS/font injection.
const SAFE_FONTS = [
  "Inter",
  "Poppins",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Nunito",
  "Playfair Display",
  "Merriweather",
  "system-ui",
];

// Layout options are enums, never free-form strings, so a restaurant user can
// never inject markup/styles through the settings API.
const HERO_STYLES = ["classic", "split", "minimal", "fullbleed"];
const CARD_STYLES = ["grid", "list", "compact", "showcase"];
const HEADER_STYLES = ["standard", "centered", "transparent"];
const FOOTER_STYLES = ["standard", "minimal", "detailed"];
const NAV_STYLES = ["pills", "tabs", "sidebar"];
const IMAGE_POSITIONS = ["top", "left", "right"];
const BUTTON_STYLES = ["rounded", "pill", "square"];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hexColor = (defaultValue) => ({
  type: String,
  default: defaultValue,
  validate: {
    validator: (v) => !v || HEX.test(v),
    message: "Color must be a valid hex value (e.g. #ff5722)",
  },
});

// A media pointer: we store the MediaAsset id AND a denormalized url so the
// storefront can render without an extra population round-trip.
const mediaRefSchema = new mongoose.Schema(
  {
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    url: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    alt: { type: String, default: "" },
  },
  { _id: false }
);

const openingHourSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    isOpen: { type: Boolean, default: true },
    openTime: { type: String, default: "09:00" }, // HH:mm
    closeTime: { type: String, default: "22:00" }, // HH:mm
  },
  { _id: false }
);

const brandingSchema = new mongoose.Schema(
  {
    siteTitle: { type: String, default: "", maxlength: 120 },
    siteDescription: { type: String, default: "", maxlength: 400 },
    tagline: { type: String, default: "", maxlength: 200 },
    aboutText: { type: String, default: "", maxlength: 4000 },
    logo: { type: mediaRefSchema, default: () => ({}) },
    favicon: { type: mediaRefSchema, default: () => ({}) },
    coverImage: { type: mediaRefSchema, default: () => ({}) },
  },
  { _id: false }
);

const themeSettingsSchema = new mongoose.Schema(
  {
    // Theme key — only "default-restaurant" ships today, but the storefront
    // renderer resolves the theme by key so new themes can be added later
    // without touching the ordering/cart/checkout engine.
    themeKey: { type: String, default: "default-restaurant" },
    colors: {
      primary: hexColor("#e2571e"),
      secondary: hexColor("#0d1526"),
      accent: hexColor("#f5a524"),
      background: hexColor("#ffffff"),
      surface: hexColor("#f7f8fa"),
      text: hexColor("#12161f"),
      muted: hexColor("#6b7280"),
      button: hexColor("#e2571e"),
      buttonText: hexColor("#ffffff"),
    },
    typography: {
      headingFont: { type: String, enum: SAFE_FONTS, default: "Poppins" },
      bodyFont: { type: String, enum: SAFE_FONTS, default: "Inter" },
      baseSize: { type: Number, min: 12, max: 20, default: 16 },
    },
    layout: {
      heroStyle: { type: String, enum: HERO_STYLES, default: "classic" },
      productCardStyle: { type: String, enum: CARD_STYLES, default: "grid" },
      categoryNavStyle: { type: String, enum: NAV_STYLES, default: "pills" },
      productImagePosition: { type: String, enum: IMAGE_POSITIONS, default: "top" },
      buttonStyle: { type: String, enum: BUTTON_STYLES, default: "rounded" },
      headerStyle: { type: String, enum: HEADER_STYLES, default: "standard" },
      footerStyle: { type: String, enum: FOOTER_STYLES, default: "standard" },
    },
    sections: {
      showOffers: { type: Boolean, default: true },
      showAbout: { type: Boolean, default: true },
      showContact: { type: Boolean, default: true },
      showGallery: { type: Boolean, default: false },
      showHours: { type: Boolean, default: true },
    },
  },
  { _id: false }
);

const orderingSchema = new mongoose.Schema(
  {
    pickupEnabled: { type: Boolean, default: true },
    deliveryEnabled: { type: Boolean, default: false },
    // All monetary config lives server-side; the client never supplies these.
    minOrderValue: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    freeDeliveryAbove: { type: Number, default: 0, min: 0 },
    packagingFee: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxInclusive: { type: Boolean, default: false },
    currency: { type: String, default: "INR" },
    currencySymbol: { type: String, default: "₹" },
    acceptPreOrders: { type: Boolean, default: true },
    prepTimeMinutes: { type: Number, default: 30, min: 0 },
    specialInstructionsEnabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const contactSchema = new mongoose.Schema(
  {
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    addressLine1: { type: String, default: "" },
    addressLine2: { type: String, default: "" },
    city: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    mapUrl: { type: String, default: "" },
    social: {
      facebook: { type: String, default: "" },
      instagram: { type: String, default: "" },
      twitter: { type: String, default: "" },
    },
  },
  { _id: false }
);

const offerSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 400 },
  code: { type: String, default: "", maxlength: 40 },
  image: { type: mediaRefSchema, default: () => ({}) },
  isActive: { type: Boolean, default: true },
});

const websiteSettingsSchema = new mongoose.Schema(
  {
    // --- Ownership / tenancy ---
    storeId: { type: String, required: true, unique: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },

    // --- Public identity / routing ---
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    subdomain: { type: String, default: "", lowercase: true, trim: true },
    customDomain: { type: String, default: "", lowercase: true, trim: true },

    // --- Master switch (§20) ---
    enabled: { type: Boolean, default: true },
    disabledMessage: {
      type: String,
      default: "Online ordering is currently unavailable. Please try again later.",
      maxlength: 300,
    },

    displayName: { type: String, default: "", maxlength: 160 },
    branding: { type: brandingSchema, default: () => ({}) },
    theme: { type: themeSettingsSchema, default: () => ({}) },
    ordering: { type: orderingSchema, default: () => ({}) },
    contact: { type: contactSchema, default: () => ({}) },
    offers: { type: [offerSchema], default: [] },
    openingHours: { type: [openingHourSchema], default: [] },
    // Empty array => fall back to "always open"; business hour evaluation is
    // centralised in services/businessHours.js so POS + storefront agree.
    useBusinessHours: { type: Boolean, default: false },

    // --- Publishing model (§27) ---
    // Today we publish automatically on save. `draft` holds an optional
    // pending copy so a Draft/Publish workflow can be layered on later
    // without a migration.
    status: { type: String, enum: ["draft", "published"], default: "published" },
    draft: { type: mongoose.Schema.Types.Mixed, default: null },
    publishedAt: { type: Date, default: Date.now },
    version: { type: Number, default: 1 },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

websiteSettingsSchema.index({ customDomain: 1 }, { sparse: true });
websiteSettingsSchema.index({ subdomain: 1 }, { sparse: true });
websiteSettingsSchema.index({ restaurantId: 1, isDeleted: 1 });

module.exports = mongoose.model("WebsiteSettings", websiteSettingsSchema);
module.exports.SAFE_FONTS = SAFE_FONTS;
module.exports.HERO_STYLES = HERO_STYLES;
module.exports.CARD_STYLES = CARD_STYLES;
module.exports.HEADER_STYLES = HEADER_STYLES;
module.exports.FOOTER_STYLES = FOOTER_STYLES;
module.exports.NAV_STYLES = NAV_STYLES;
module.exports.IMAGE_POSITIONS = IMAGE_POSITIONS;
module.exports.BUTTON_STYLES = BUTTON_STYLES;
