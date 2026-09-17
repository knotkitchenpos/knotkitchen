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

/**
 * Landing page templates.
 *
 * The customer website opens on a landing page and the menu lives one click
 * behind it, so this list is the whole visual identity of a restaurant's front
 * door. Each key maps to one page component under customer-web's
 * components/landing/; adding a key here without adding the page there renders
 * the fallback.
 *
 * The five are five kinds of restaurant rather than five colour schemes,
 * because that is what an owner is actually choosing between.
 */
const LANDING_TEMPLATES = [
  "peddler",
  "citrus",
  "night",
  "garden",
  "sunset",
];

/**
 * The first attempt's keys, kept readable.
 *
 * Those five were layout descriptions ("card-stack") rather than kinds of
 * restaurant, and every one of them was replaced. Stores that had already
 * chosen one are mapped to the nearest new design rather than being silently
 * reset to the default, which is what an unknown key would otherwise do.
 *
 * Storage-only: `enum` above does not accept these, so nothing new can be
 * saved under one. They are translated on read in services/landingPayload.js.
 */
const LEGACY_LANDING_TEMPLATES = Object.freeze({
  // Second set (replaced by the Templates folder designs).
  "fine-dining": "night",
  "farm-to-table": "garden",
  omakase: "night",
  "coastal-brunch": "sunset",
  "urban-izakaya": "citrus",
  // First set.
  "hero-classic": "peddler",
  "split-showcase": "garden",
  "minimal-center": "sunset",
  "photo-fullbleed": "night",
  "card-stack": "citrus",
});

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
    activeGateway: { type: String, enum: ["cashfree", "phonepe"], default: "cashfree" },
    cashfree: { type: gatewayCredentialsSchema, default: () => ({}) },
    phonepe: { type: gatewayCredentialsSchema, default: () => ({}) },
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

/**
 * One short selling point, three of which sit under the hero.
 *
 * Every restaurant site of this kind has them -- "Authentic Origins",
 * "Handcrafted with Heart", "Since 1993" -- and they are the cheapest way for
 * a landing page to say something specific rather than generic.
 */
/**
 * The words on a landing design, set per restaurant in the CSD. Empty means
 * "use the design's own wording" (customer-web landing/content.js).
 */
const landingCopySchema = new mongoose.Schema(
  {
    kicker: { type: String, default: "", maxlength: 60 },
    headline: { type: String, default: "", maxlength: 80 },
    headlineAccent: { type: String, default: "", maxlength: 80 },
    lead: { type: String, default: "", maxlength: 300 },
    heroBadge: { type: String, default: "", maxlength: 30 },
    heroNote: { type: String, default: "", maxlength: 40 },
    storyTitle: { type: String, default: "", maxlength: 80 },
    storyAccent: { type: String, default: "", maxlength: 80 },
    menuTitle: { type: String, default: "", maxlength: 80 },
    menuAccent: { type: String, default: "", maxlength: 80 },
    ctaTitle: { type: String, default: "", maxlength: 80 },
    ctaLead: { type: String, default: "", maxlength: 160 },
    ctaText: { type: String, default: "", maxlength: 40 },
    visitTitle: { type: String, default: "", maxlength: 80 },
    hoursText: { type: String, default: "", maxlength: 120 },
    footerTagline: { type: String, default: "", maxlength: 80 },
  },
  { _id: false }
);

const landingFeatureSchema = new mongoose.Schema(
  {
    title: { type: String, default: "", maxlength: 60 },
    text: { type: String, default: "", maxlength: 240 },
    image: { type: mediaRefSchema, default: () => ({}) },
  },
  { _id: false }
);

/**
 * The landing page a customer sees before the menu.
 *
 * Every text field defaults to empty on purpose: empty means "fall back to
 * branding", so a restaurant that never opens this editor still gets a landing
 * page built from the site title, tagline and cover image it already has.
 * Storing a copy of those strings here would give us two sources for the same
 * headline and they would drift apart the first time one of them was edited.
 *
 * The images are the point of the whole sub-document. A landing page with the
 * restaurant's own photographs in it looks like that restaurant; the same page
 * with stock gradients looks like every other tenant on the platform. So there
 * is a slot for the hero, one for the story section, one per selling point,
 * and a gallery -- all pointing at the store's own media library.
 */
const landingSchema = new mongoose.Schema(
  {
    template: { type: String, enum: LANDING_TEMPLATES, default: LANDING_TEMPLATES[0] },
    headline: { type: String, default: "", maxlength: 120 },
    subheadline: { type: String, default: "", maxlength: 300 },
    ctaText: { type: String, default: "View Menu", maxlength: 40 },
    backgroundImage: { type: mediaRefSchema, default: () => ({}) },
    // How dark the scrim over the background photo is. A bright food photo
    // needs more of it than a dim one for the headline to stay readable.
    overlayOpacity: { type: Number, min: 0, max: 100, default: 45 },

    // The story section.
    aboutImage: { type: mediaRefSchema, default: () => ({}) },
    aboutText: { type: String, default: "", maxlength: 4000 },

    features: { type: [landingFeatureSchema], default: [] },
    gallery: { type: [mediaRefSchema], default: [] },
    copy: { type: landingCopySchema, default: () => ({}) },

    /**
     * The two or three dishes the landing page puts in front of a customer.
     *
     * NOT the menu. A landing page that prints the whole catalogue is the
     * ordering page with no basket, only slower -- so the front door shows a
     * few things worth coming for and hands the customer on. Menu item ids;
     * an id that no longer exists is skipped, and an empty list falls back to
     * the first few available dishes so a store that never picks any still
     * has something to show.
     */
    featuredItems: { type: [mongoose.Schema.Types.ObjectId], default: [] },

    showAbout: { type: Boolean, default: true },
    showMenuPreview: { type: Boolean, default: true },
    showGallery: { type: Boolean, default: true },
    showHours: { type: Boolean, default: true },
    showContact: { type: Boolean, default: true },
    showOffers: { type: Boolean, default: true },
  },
  { _id: false }
);

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
    // Table booking from the website. Times are restaurant-local "HH:MM".
    tableBooking: {
      enabled: { type: Boolean, default: true },
      openTime: { type: String, default: "16:00" },
      closeTime: { type: String, default: "22:00" },
      slotMinutes: { type: Number, default: 30, min: 5, max: 240 },
      // The table stops taking new orders this long before the booked time...
      holdBeforeMinutes: { type: Number, default: 30, min: 0, max: 24 * 60 },
      // ...and is let go this long after it if the party never arrives.
      releaseAfterMinutes: { type: Number, default: 60, min: 0, max: 24 * 60 },
    },
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

/**
 * Manage Website > Legal: the restaurant-specific values the five legal
 * pages (Terms, Privacy, Refund & Cancellation, Return, Shipping & Delivery)
 * substitute into their text. Blank means "use the default the policy was
 * written for" (services/websitePublicInfo.js).
 */
const legalSchema = new mongoose.Schema(
  {
    grievanceName: { type: String, default: "", maxlength: 120 },
    grievanceEmail: { type: String, default: "", maxlength: 160 },
    grievancePhone: { type: String, default: "", maxlength: 30 },
    grievanceHours: { type: String, default: "", maxlength: 80 },
    refundWindowHours: { type: Number, default: 24, min: 1, max: 720 },
    refundAckHours: { type: Number, default: 24, min: 1, max: 720 },
    refundDecisionDays: { type: Number, default: 3, min: 1, max: 60 },
    refundProcessingDays: { type: Number, default: 7, min: 1, max: 60 },
    returnWindowDays: { type: Number, default: 7, min: 1, max: 90 },
    jurisdictionCity: { type: String, default: "", maxlength: 80 },
    updatedAt: { type: Date, default: null },
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
    landing: { type: landingSchema, default: () => ({}) },
    theme: { type: themeSettingsSchema, default: () => ({}) },
    ordering: { type: orderingSchema, default: () => ({}) },
    contact: { type: contactSchema, default: () => ({}) },
    legal: { type: legalSchema, default: () => ({}) },
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
module.exports.LANDING_TEMPLATES = LANDING_TEMPLATES;
module.exports.LEGACY_LANDING_TEMPLATES = LEGACY_LANDING_TEMPLATES;
module.exports.HERO_STYLES = HERO_STYLES;
module.exports.CARD_STYLES = CARD_STYLES;
module.exports.HEADER_STYLES = HEADER_STYLES;
module.exports.FOOTER_STYLES = FOOTER_STYLES;
module.exports.NAV_STYLES = NAV_STYLES;
module.exports.IMAGE_POSITIONS = IMAGE_POSITIONS;
module.exports.BUTTON_STYLES = BUTTON_STYLES;
