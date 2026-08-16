const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const WebsiteSettings = require("../models/websiteSettingsModel");
const MediaAsset = require("../models/mediaAssetModel");
const Store = require("../models/storeModel");
const { resolveTenantFromUser } = require("../services/tenantContext");
const { provisionWebsiteForStore, buildStorefrontUrl } = require("../services/websiteProvisioningService");
const { listThemes, isSelectableTheme } = require("../services/themeRegistry");
const { slugify, isValidSlug, RESERVED_SLUGS } = require("../services/slugService");
const {
  SAFE_FONTS, HERO_STYLES, CARD_STYLES, HEADER_STYLES,
  FOOTER_STYLES, NAV_STYLES, IMAGE_POSITIONS, BUTTON_STYLES,
} = require("../models/websiteSettingsModel");

/**
 * Website customization API (§3, §19, §26).
 *
 * SECURITY MODEL — every value written here is whitelisted:
 *   • colors must match a strict hex pattern
 *   • fonts/layout values must be members of a fixed enum
 *   • text fields are length-clamped and stored as plain text
 *   • image fields must reference a MediaAsset owned by THIS store
 * There is no code path that lets a restaurant user persist raw HTML/CSS/JS,
 * which is what makes the shared storefront renderer safe (§3, §24).
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const clampText = (value, max) =>
  typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : undefined;

const pickEnum = (value, allowed) => (allowed.includes(value) ? value : undefined);

const pickHex = (value) => (typeof value === "string" && HEX.test(value.trim()) ? value.trim() : undefined);

const assign = (target, key, value) => {
  if (value !== undefined) target[key] = value;
};

/**
 * Resolve an incoming image reference to a media record OWNED BY THIS STORE.
 * A mediaId belonging to another tenant is rejected — this is the check that
 * stops Store A from embedding Store B's private assets.
 */
const resolveMediaRef = async (input, tenant) => {
  if (input === null) return { mediaId: null, url: "", thumbnailUrl: "", alt: "" };
  if (!input || typeof input !== "object") return undefined;
  if (!input.mediaId) return undefined;
  if (!mongoose.Types.ObjectId.isValid(input.mediaId)) {
    throw createHttpError(400, "Invalid image reference.");
  }

  const asset = await MediaAsset.findOne({
    _id: input.mediaId,
    storeId: tenant.storeId,
    isDeleted: { $ne: true },
  });
  if (!asset) throw createHttpError(404, "Selected image was not found in your media library.");

  return {
    mediaId: asset._id,
    url: asset.url,
    thumbnailUrl: asset.thumbnailUrl || asset.url,
    alt: clampText(input.alt, 200) || asset.altText || "",
  };
};

/** Load (auto-provisioning if missing) the caller's website settings. */
const loadOwnSettings = async (req) => {
  const tenant = await resolveTenantFromUser(req.user);
  if (!tenant.storeId) throw createHttpError(400, "Your account is not linked to a store yet.");

  let settings = await WebsiteSettings.findOne({ storeId: tenant.storeId, isDeleted: { $ne: true } });

  // Self-healing: stores created before this feature existed get provisioned
  // on first access instead of erroring.
  if (!settings) {
    const store = await Store.findOne({ storeId: tenant.storeId, isDeleted: { $ne: true } });
    settings = await provisionWebsiteForStore({
      storeId: tenant.storeId,
      storeName: store?.storeName || "",
      restaurantId: tenant.restaurantId,
      outletId: tenant.outletId,
    });
  }

  return { tenant, settings };
};

/** GET /api/website/settings */
const getWebsiteSettings = async (req, res, next) => {
  try {
    const { settings } = await loadOwnSettings(req);
    res.status(200).json({
      success: true,
      data: {
        settings,
        storefrontUrl: buildStorefrontUrl(settings),
        themes: listThemes(),
        options: {
          fonts: SAFE_FONTS,
          heroStyles: HERO_STYLES,
          productCardStyles: CARD_STYLES,
          headerStyles: HEADER_STYLES,
          footerStyles: FOOTER_STYLES,
          categoryNavStyles: NAV_STYLES,
          imagePositions: IMAGE_POSITIONS,
          buttonStyles: BUTTON_STYLES,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/website/settings — whitelisted partial update. */
const updateWebsiteSettings = async (req, res, next) => {
  try {
    const { tenant, settings } = await loadOwnSettings(req);
    const body = req.body || {};

    // ---- Master switch & display ----
    if (typeof body.enabled === "boolean") settings.enabled = body.enabled;
    assign(settings, "disabledMessage", clampText(body.disabledMessage, 300));
    assign(settings, "displayName", clampText(body.displayName, 160));

    // ---- Slug (public identifier) ----
    if (body.slug !== undefined) {
      const candidate = slugify(body.slug);
      if (!isValidSlug(candidate)) {
        return next(createHttpError(400, "Website address must be 2-60 letters, numbers or hyphens."));
      }
      if (RESERVED_SLUGS.has(candidate)) {
        return next(createHttpError(400, "That website address is reserved. Please choose another."));
      }
      if (candidate !== settings.slug) {
        const taken = await WebsiteSettings.findOne({ slug: candidate, isDeleted: { $ne: true } });
        if (taken && String(taken.storeId) !== String(tenant.storeId)) {
          return next(createHttpError(409, "That website address is already taken."));
        }
        settings.slug = candidate;
      }
    }

    // ---- Branding ----
    if (body.branding) {
      const b = body.branding;
      assign(settings.branding, "siteTitle", clampText(b.siteTitle, 120));
      assign(settings.branding, "siteDescription", clampText(b.siteDescription, 400));
      assign(settings.branding, "tagline", clampText(b.tagline, 200));
      assign(settings.branding, "aboutText", clampText(b.aboutText, 4000));

      for (const key of ["logo", "favicon", "coverImage"]) {
        if (b[key] !== undefined) {
          const ref = await resolveMediaRef(b[key], tenant);
          if (ref !== undefined) settings.branding[key] = ref;
        }
      }
    }

    // ---- Theme / colors / typography / layout ----
    if (body.theme) {
      const t = body.theme;

      if (t.themeKey !== undefined) {
        if (!isSelectableTheme(t.themeKey)) {
          return next(createHttpError(400, "That theme is not available yet."));
        }
        settings.theme.themeKey = t.themeKey;
      }

      if (t.colors) {
        for (const key of ["primary", "secondary", "accent", "background", "surface", "text", "muted", "button", "buttonText"]) {
          assign(settings.theme.colors, key, pickHex(t.colors[key]));
        }
      }

      if (t.typography) {
        assign(settings.theme.typography, "headingFont", pickEnum(t.typography.headingFont, SAFE_FONTS));
        assign(settings.theme.typography, "bodyFont", pickEnum(t.typography.bodyFont, SAFE_FONTS));
        const size = Number(t.typography.baseSize);
        if (Number.isFinite(size) && size >= 12 && size <= 20) settings.theme.typography.baseSize = size;
      }

      if (t.layout) {
        assign(settings.theme.layout, "heroStyle", pickEnum(t.layout.heroStyle, HERO_STYLES));
        assign(settings.theme.layout, "productCardStyle", pickEnum(t.layout.productCardStyle, CARD_STYLES));
        assign(settings.theme.layout, "categoryNavStyle", pickEnum(t.layout.categoryNavStyle, NAV_STYLES));
        assign(settings.theme.layout, "productImagePosition", pickEnum(t.layout.productImagePosition, IMAGE_POSITIONS));
        assign(settings.theme.layout, "buttonStyle", pickEnum(t.layout.buttonStyle, BUTTON_STYLES));
        assign(settings.theme.layout, "headerStyle", pickEnum(t.layout.headerStyle, HEADER_STYLES));
        assign(settings.theme.layout, "footerStyle", pickEnum(t.layout.footerStyle, FOOTER_STYLES));
      }

      if (t.sections) {
        for (const key of ["showOffers", "showAbout", "showContact", "showGallery", "showHours"]) {
          if (typeof t.sections[key] === "boolean") settings.theme.sections[key] = t.sections[key];
        }
      }
    }

    // ---- Ordering / fees ----
    if (body.ordering) {
      const o = body.ordering;
      for (const key of ["pickupEnabled", "deliveryEnabled", "taxInclusive", "acceptPreOrders", "specialInstructionsEnabled"]) {
        if (typeof o[key] === "boolean") settings.ordering[key] = o[key];
      }
      for (const key of ["minOrderValue", "deliveryFee", "freeDeliveryAbove", "packagingFee", "prepTimeMinutes"]) {
        const value = Number(o[key]);
        if (Number.isFinite(value) && value >= 0 && value < 1_000_000) settings.ordering[key] = value;
      }
      const tax = Number(o.taxPercent);
      if (Number.isFinite(tax) && tax >= 0 && tax <= 100) settings.ordering.taxPercent = tax;
      assign(settings.ordering, "currency", clampText(o.currency, 8));
      assign(settings.ordering, "currencySymbol", clampText(o.currencySymbol, 4));
    }

    // ---- Contact ----
    if (body.contact) {
      const c = body.contact;
      for (const [key, max] of [["phone", 30], ["email", 160], ["addressLine1", 200], ["addressLine2", 200], ["city", 100], ["postalCode", 20], ["mapUrl", 500]]) {
        assign(settings.contact, key, clampText(c[key], max));
      }
      if (c.social) {
        for (const key of ["facebook", "instagram", "twitter"]) {
          assign(settings.contact.social, key, clampText(c.social[key], 200));
        }
      }
    }

    // ---- Opening hours ----
    if (Array.isArray(body.openingHours)) {
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      settings.openingHours = body.openingHours
        .filter((h) => Number.isInteger(Number(h?.day)) && Number(h.day) >= 0 && Number(h.day) <= 6)
        .slice(0, 7)
        .map((h) => ({
          day: Number(h.day),
          isOpen: Boolean(h.isOpen),
          openTime: timePattern.test(h.openTime) ? h.openTime : "09:00",
          closeTime: timePattern.test(h.closeTime) ? h.closeTime : "22:00",
        }));
    }
    if (typeof body.useBusinessHours === "boolean") settings.useBusinessHours = body.useBusinessHours;

    // ---- Offers ----
    if (Array.isArray(body.offers)) {
      const offers = [];
      for (const offer of body.offers.slice(0, 20)) {
        const title = clampText(offer?.title, 120);
        if (!title) continue;
        const image = offer?.image ? await resolveMediaRef(offer.image, tenant) : undefined;
        offers.push({
          title,
          description: clampText(offer?.description, 400) || "",
          code: clampText(offer?.code, 40) || "",
          isActive: offer?.isActive !== false,
          ...(image ? { image } : {}),
        });
      }
      settings.offers = offers;
    }

    settings.version += 1;
    settings.publishedAt = new Date();
    await settings.save();

    res.status(200).json({
      success: true,
      message: "Website settings updated",
      data: { settings, storefrontUrl: buildStorefrontUrl(settings) },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createHttpError(409, "That website address is already taken."));
    }
    next(error);
  }
};

/**
 * GET /api/website/preview (§26)
 * Returns the same payload shape the public storefront consumes, but built
 * from the caller's own (possibly unpublished) settings and authenticated
 * session — so an admin can preview without exposing anything publicly.
 */
const previewWebsite = async (req, res, next) => {
  try {
    const { tenant, settings } = await loadOwnSettings(req);
    const { buildStorefrontPayload } = require("./storefrontController");

    const payload = await buildStorefrontPayload({
      settings,
      restaurantId: tenant.restaurantId,
      storeId: tenant.storeId,
      // Preview intentionally ignores the "website disabled" and business-hour
      // gates so the owner can always see their site.
      preview: true,
    });

    res.status(200).json({ success: true, data: payload });
  } catch (error) {
    next(error);
  }
};

module.exports = { getWebsiteSettings, updateWebsiteSettings, previewWebsite, loadOwnSettings };
