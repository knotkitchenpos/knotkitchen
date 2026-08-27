const mongoose = require("mongoose");

/**
 * WebsiteSettings — one document per Store. This is the "storefront config"
 * that powers the public customer website.
 */

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

const mediaRefSchema = new mongoose.Schema(
  {
    mediaId: { type: mongoose.Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    url: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    alt: { type: String, default: "" },
  },
  { _id: false }
);

const gatewayCredentialsSchema = new mongoose.Schema(
  {
    keyId: { type: String, default: "", trim: true },
    keySecretMasked: { type: String, default: "", trim: true },
    keySecretEncrypted: { type: String, default: "" },
    environment: { type: String, enum: ["TEST", "PROD", "UAT"], default: "TEST" },
    isConfigured: { type: Boolean, default: false },

    // PhonePe specific fields
    merchantId: { type: String, default: "", trim: true },
    saltKeyMasked: { type: String, default: "", trim: true },
    saltKeyEncrypted: { type: String, default: "" },
    saltIndex: { type: String, default: "1", trim: true },

    // Cashfree specific fields
    clientId: { type: String, default: "", trim: true },
    clientSecretMasked: { type: String, default: "", trim: true },
    clientSecretEncrypted: { type: String, default: "" },
  },
  { _id: false }
);

const paymentGatewaysSchema = new mongoose.Schema(
  {
    activeGateway: { type: String, enum: ["cashfree", "phonepe", "razorpay"], default: "razorpay" },
    cashfree: { type: gatewayCredentialsSchema, default: () => ({}) },
    phonepe: { type: gatewayCredentialsSchema, default: () => ({}) },
    razorpay: { type: gatewayCredentialsSchema, default: () => ({}) },
  },
  { _id: false }
);

const bannerSchema = new mongoose.Schema({
  title: { type: String, required: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 400 },
  buttonText: { type: String, default: "Order Now", maxlength: 40 },
  linkUrl: { type: String, default: "", maxlength: 200 },
  image: { type: mediaRefSchema, default: () => ({}) },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
});

const sectionTitlesSchema = new mongoose.Schema(
  {
    heroTitle: { type: String, default: "Welcome to Our Restaurant", maxlength: 120 },
    heroSubtitle: { type: String, default: "Delicious Food Delivered to Your Door", maxlength: 200 },
    menuTitle: { type: String, default: "Our Menu", maxlength: 120 },
    aboutTitle: { type: String, default: "About Us", maxlength: 120 },
    offersTitle: { type: String, default: "Special Offers", maxlength: 120 },
    contactTitle: { type: String, default: "Contact Us", maxlength: 120 },
  },
  { _id: false }
);

const openingHourSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    isOpen: { type: Boolean, default: true },
    openTime: { type: String, default: "09:00" }, // HH:mm
    closeDay: { type: Number, min: 0, max: 6, default: null }, // 0 = Sunday, 1 = Monday...
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

const distanceSlabSchema = new mongoose.Schema(
  {
    minKm: { type: Number, required: true, min: 0 },
    maxKm: { type: Number, required: true, min: 0 },
    fee: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const minOrderChannelSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    amount: { type: Number, default: 0, min: 0 },
    applyTo: { type: String, enum: ["system", "website", "both"], default: "both" },
  },
  { _id: false }
);

const discountRuleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 120 },
    type: { type: String, enum: ["percent", "fixed"], default: "percent" },
    value: { type: Number, required: true, min: 0 },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    channels: {
      collection: { type: Boolean, default: true },
      delivery: { type: Boolean, default: true },
      table: { type: Boolean, default: true },
    },
    applyTo: { type: String, enum: ["system", "website", "both"], default: "both" },
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    startTime: { type: String, default: "00:00" },
    endTime: { type: String, default: "23:59" },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const couponRuleSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percent", "fixed"], default: "percent" },
    value: { type: Number, required: true, min: 0 },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    quantityTotal: { type: Number, default: 100 },
    quantityUsed: { type: Number, default: 0 },
    usageLimitPerPhone: { type: Number, default: 1 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    channels: {
      collection: { type: Boolean, default: true },
      delivery: { type: Boolean, default: true },
      table: { type: Boolean, default: true },
    },
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    startTime: { type: String, default: "00:00" },
    endTime: { type: String, default: "23:59" },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const freeItemRuleSchema = new mongoose.Schema(
  {
    menuItemId: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
    itemName: { type: String, required: true },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    channels: {
      collection: { type: Boolean, default: true },
      delivery: { type: Boolean, default: true },
      table: { type: Boolean, default: true },
    },
    applyTo: { type: String, enum: ["system", "website", "both"], default: "both" },
    daysOfWeek: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    startTime: { type: String, default: "00:00" },
    endTime: { type: String, default: "23:59" },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const orderingSchema = new mongoose.Schema(
  {
    pickupEnabled: { type: Boolean, default: true },
    deliveryEnabled: { type: Boolean, default: false },
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
    autoReadyMinutes: {
      collection: { type: Number, default: 20, min: 0, max: 24 * 60 },
      delivery: { type: Number, default: 45, min: 0, max: 24 * 60 },
      table: { type: Number, default: 20, min: 0, max: 24 * 60 },
    },
    autoCompleteMinutes: {
      collection: { type: Number, default: 0, min: 0, max: 24 * 60 },
      delivery: { type: Number, default: 0, min: 0, max: 24 * 60 },
      table: { type: Number, default: 0, min: 0, max: 24 * 60 },
    },

    // Module 8 §1 — Minimum order per channel & applicability
    minOrderConfig: {
      collection: { type: minOrderChannelSchema, default: () => ({}) },
      delivery: { type: minOrderChannelSchema, default: () => ({}) },
      table: { type: minOrderChannelSchema, default: () => ({}) },
    },

    // Module 8 §2 — Delivery distance slabs & max distance
    deliverySlabsConfig: {
      maxDistanceKm: { type: Number, default: 7, min: 0 },
      slabs: { type: [distanceSlabSchema], default: () => [] },
    },

    // Module 8 §3 — GST & Packing applicability
    gstApplyTo: { type: String, enum: ["system", "website", "both"], default: "both" },
    packingApplyTo: { type: String, enum: ["system", "website", "both"], default: "both" },
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

const channelScheduleSchema = new mongoose.Schema(
  {
    sameTimingAllDays: { type: Boolean, default: true },
    sameTiming: { openTime: { type: String, default: "09:00" }, closeTime: { type: String, default: "22:00" } },
    weekly: { type: [openingHourSchema], default: () => [] },
  },
  { _id: false }
);

const holidaySchema = new mongoose.Schema(
  {
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    reason: { type: String, default: "Store Closed for Holiday" },
  },
  { _id: false }
);

const websiteSettingsSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, unique: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", index: true },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet", default: null },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    subdomain: { type: String, default: "", lowercase: true, trim: true },
    customDomain: { type: String, default: "", lowercase: true, trim: true },
    enabled: { type: Boolean, default: true },
    disabledMessage: {
      type: String,
      default: "Online ordering is currently unavailable. Please try again later.",
      maxlength: 300,
    },
    displayName: { type: String, default: "", maxlength: 160 },
    branding: { type: brandingSchema, default: () => ({}) },
    sectionTitles: { type: sectionTitlesSchema, default: () => ({}) },
    banners: { type: [bannerSchema], default: [] },
    theme: { type: themeSettingsSchema, default: () => ({}) },
    ordering: { type: orderingSchema, default: () => ({}) },
    contact: { type: contactSchema, default: () => ({}) },
    offers: { type: [offerSchema], default: [] },
    openingHours: { type: [openingHourSchema], default: [] },
    useBusinessHours: { type: Boolean, default: false },

    channelHours: {
      collection: { type: channelScheduleSchema, default: () => ({}) },
      delivery: { type: channelScheduleSchema, default: () => ({}) },
      table: { type: channelScheduleSchema, default: () => ({}) },
    },

    holidays: { type: [holidaySchema], default: [] },
    closedForToday: {
      enabled: { type: Boolean, default: false },
      date: { type: String, default: "" },
      reason: { type: String, default: "Closed for Today" },
    },
    paymentGateways: { type: paymentGatewaysSchema, default: () => ({}) },

    // Module 8 §4 — Discounts
    discountsConfig: { type: [discountRuleSchema], default: [] },

    // Module 8 §5 — Coupons (Website-only)
    couponsConfig: { type: [couponRuleSchema], default: [] },

    // Module 8 §6 — Free Item promotions
    freeItemConfig: { type: [freeItemRuleSchema], default: [] },


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
