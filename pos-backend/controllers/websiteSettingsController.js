const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const WebsiteSettings = require("../models/websiteSettingsModel");
const MediaAsset = require("../models/mediaAssetModel");
const Store = require("../models/storeModel");
const { resolveTenantFromUser } = require("../services/tenantContext");
const { seal } = require("../services/secretBox");
const { provisionWebsiteForStore, buildStorefrontUrl } = require("../services/websiteProvisioningService");
const { listThemes, isSelectableTheme } = require("../services/themeRegistry");
const {
  SAFE_FONTS, HERO_STYLES, CARD_STYLES, HEADER_STYLES,
  FOOTER_STYLES, NAV_STYLES, IMAGE_POSITIONS, BUTTON_STYLES,
  LANDING_TEMPLATES,
} = require("../models/websiteSettingsModel");
const { logActivity } = require("../services/auditService");

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
 * Strips sensitive encrypted gateway secrets before sending settings to frontend (§19, §26).
 */
const sanitizeSettings = (doc) => {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : JSON.parse(JSON.stringify(doc));
  if (obj.paymentGateways) {
    for (const gwKey of ["cashfree", "phonepe"]) {
      if (obj.paymentGateways[gwKey]) {
        delete obj.paymentGateways[gwKey].clientSecretEncrypted;
        delete obj.paymentGateways[gwKey].saltKeyEncrypted;
      }
    }
  }
  if (obj.draft && obj.draft.paymentGateways) {
    for (const gwKey of ["cashfree", "phonepe"]) {
      if (obj.draft.paymentGateways[gwKey]) {
        delete obj.draft.paymentGateways[gwKey].clientSecretEncrypted;
        delete obj.draft.paymentGateways[gwKey].saltKeyEncrypted;
      }
    }
  }
  return obj;
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
        settings: sanitizeSettings(settings),
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
          landingTemplates: LANDING_TEMPLATES,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/website/settings — whitelisted partial update. */
/**
 * The Manage Website screen's own fields.
 *
 * That screen is CSD-only, but it shares this endpoint with POS Settings,
 * which legitimately writes `ordering`, `couponsConfig` and `freeItemConfig`
 * (Order Toggles, Rules & Charges). Locking the route would have taken those
 * down too, so the boundary is drawn here, per field.
 *
 * Rejected rather than silently dropped: an operator who cannot change a
 * setting must be told, not shown a save that did nothing.
 */
/**
 * Manage Website belongs to the restaurant.
 *
 * For a period every storefront field here -- branding, theme, banners, the
 * web address, the payment gateway -- was refused unless the caller was CSD
 * support staff, and the POS had no screen for it at all. That is reversed:
 * an owner configures their own website, and support helps rather than holds
 * the only key.
 *
 * The per-field rules that remain are the ones that are about competence and
 * safety rather than about who owns the section:
 *   - payment gateway credentials are Owner-only (see the block below), so a
 *     waiter cannot repoint the restaurant's takings,
 *   - a slug or custom domain already claimed by another store is refused,
 *     because two restaurants cannot share one public address.
 */
const updateWebsiteSettings = async (req, res, next) => {
  try {
    const { tenant, settings } = await loadOwnSettings(req);
    const prevSnapshot = sanitizeSettings(settings);
    const body = req.body || {};

    // ---- Master switch & display ----
    if (typeof body.enabled === "boolean") settings.enabled = body.enabled;
    assign(settings, "disabledMessage", clampText(body.disabledMessage, 300));
    assign(settings, "displayName", clampText(body.displayName, 160));

    // ---- Custom Domain (Module 2) ----
    if (body.customDomain !== undefined) {
      const dom = String(body.customDomain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (dom) {
        const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
        if (!domainRegex.test(dom)) {
          return next(createHttpError(400, "Please enter a valid domain name (e.g. myrestaurant.com)."));
        }
        if (dom !== settings.customDomain) {
          const taken = await WebsiteSettings.findOne({ customDomain: dom, isDeleted: { $ne: true } });
          if (taken && String(taken.storeId) !== String(tenant.storeId)) {
            return next(createHttpError(409, "That custom domain is already claimed by another restaurant."));
          }
          settings.customDomain = dom;
        }
      } else {
        settings.customDomain = "";
      }
    }

    // ---- Slug ----
    // Not editable: the website address is the permanent store id.

    // ---- Section Titles (Module 3) ----
    if (body.sectionTitles) {
      const st = body.sectionTitles;
      assign(settings.sectionTitles, "heroTitle", clampText(st.heroTitle, 120));
      assign(settings.sectionTitles, "heroSubtitle", clampText(st.heroSubtitle, 200));
      assign(settings.sectionTitles, "menuTitle", clampText(st.menuTitle, 120));
      assign(settings.sectionTitles, "aboutTitle", clampText(st.aboutTitle, 120));
      assign(settings.sectionTitles, "offersTitle", clampText(st.offersTitle, 120));
      assign(settings.sectionTitles, "contactTitle", clampText(st.contactTitle, 120));
    }

    // ---- Banners / Slideshow (Module 3) ----
    if (Array.isArray(body.banners)) {
      const banners = [];
      for (const banner of body.banners.slice(0, 10)) {
        const title = clampText(banner?.title, 120);
        if (!title) continue;
        const image = banner?.image ? await resolveMediaRef(banner.image, tenant) : undefined;
        banners.push({
          title,
          description: clampText(banner?.description, 400) || "",
          buttonText: clampText(banner?.buttonText, 40) || "Order Now",
          linkUrl: clampText(banner?.linkUrl, 200) || "",
          isActive: banner?.isActive !== false,
          sortOrder: Number(banner?.sortOrder) || 0,
          ...(image ? { image } : {}),
        });
      }
      settings.banners = banners;
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

    // ---- Landing page ----
    // The front door: what a customer sees before the menu. Blank text fields
    // fall back to branding at render time (services/landingPayload.js), so
    // "" is a meaningful value here and is stored as sent.
    if (body.landing) {
      const l = body.landing;
      // Stores provisioned before the landing page existed have no sub-document.
      if (!settings.landing) settings.landing = {};

      if (l.template !== undefined) {
        if (!LANDING_TEMPLATES.includes(String(l.template))) {
          return next(createHttpError(400, "That landing page template is not available."));
        }
        settings.landing.template = String(l.template);
      }

      assign(settings.landing, "headline", clampText(l.headline, 120));
      assign(settings.landing, "subheadline", clampText(l.subheadline, 300));
      assign(settings.landing, "ctaText", clampText(l.ctaText, 40));
      assign(settings.landing, "aboutText", clampText(l.aboutText, 4000));

      // Ids only, at most three. The browser resolves them against the menu
      // it already has, and quietly drops any that no longer exist.
      if (Array.isArray(l.featuredItems)) {
        settings.landing.featuredItems = l.featuredItems
          .map((id) => String(id || "").trim())
          .filter((id) => mongoose.Types.ObjectId.isValid(id))
          .slice(0, 3);
      }

      for (const key of ["backgroundImage", "aboutImage"]) {
        if (l[key] !== undefined) {
          const ref = await resolveMediaRef(l[key], tenant);
          if (ref !== undefined) settings.landing[key] = ref;
        }
      }

      // Three at most. The layouts put them in a row, and a fourth would wrap
      // to a lonely second line on every screen size.
      if (Array.isArray(l.features)) {
        const features = [];
        for (const f of l.features.slice(0, 3)) {
          const image = await resolveMediaRef(f?.image, tenant);
          features.push({
            title: clampText(f?.title, 60) || "",
            text: clampText(f?.text, 240) || "",
            ...(image ? { image } : {}),
          });
        }
        settings.landing.features = features;
      }

      if (Array.isArray(l.gallery)) {
        const gallery = [];
        for (const g of l.gallery.slice(0, 12)) {
          const image = await resolveMediaRef(g, tenant);
          if (image && image.url) gallery.push(image);
        }
        settings.landing.gallery = gallery;
      }

      if (l.overlayOpacity !== undefined) {
        const pct = Number(l.overlayOpacity);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
          return next(createHttpError(400, "Photo darkening must be between 0 and 100."));
        }
        settings.landing.overlayOpacity = Math.round(pct);
      }

      for (const key of [
        "showAbout", "showMenuPreview", "showGallery",
        "showHours", "showContact", "showOffers",
      ]) {
        if (typeof l[key] === "boolean") settings.landing[key] = l[key];
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
      if (o.tableBooking && typeof o.tableBooking === "object") {
        const tb = o.tableBooking;
        const target = (settings.ordering.tableBooking = settings.ordering.tableBooking || {});
        if (typeof tb.enabled === "boolean") target.enabled = tb.enabled;
        for (const key of ["openTime", "closeTime"]) {
          if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(tb[key] || ""))) target[key] = tb[key];
        }
        for (const [key, min, max] of [["slotMinutes", 5, 240], ["holdBeforeMinutes", 0, 1440], ["releaseAfterMinutes", 0, 1440]]) {
          const value = Math.floor(Number(tb[key]));
          if (Number.isFinite(value) && value >= min && value <= max) target[key] = value;
        }
      }
      const tax = Number(o.taxPercent);
      if (Number.isFinite(tax) && tax >= 0 && tax <= 100) settings.ordering.taxPercent = tax;
      assign(settings.ordering, "currency", clampText(o.currency, 8));
      assign(settings.ordering, "currencySymbol", clampText(o.currencySymbol, 4));

      if (o.autoReadyMinutes && typeof o.autoReadyMinutes === "object") {
        settings.ordering.autoReadyMinutes = settings.ordering.autoReadyMinutes || {};
        for (const channelKey of ["collection", "delivery", "table"]) {
          const val = Number(o.autoReadyMinutes[channelKey]);
          if (Number.isFinite(val) && val >= 0 && val <= 1440) {
            settings.ordering.autoReadyMinutes[channelKey] = val;
          }
        }
      }

      if (o.autoCompleteMinutes && typeof o.autoCompleteMinutes === "object") {
        settings.ordering.autoCompleteMinutes = settings.ordering.autoCompleteMinutes || {};
        for (const channelKey of ["collection", "delivery", "table"]) {
          const val = Number(o.autoCompleteMinutes[channelKey]);
          if (Number.isFinite(val) && val >= 0 && val <= 1440) {
            settings.ordering.autoCompleteMinutes[channelKey] = val;
          }
        }
      }
    }

    // ---- Payment Gateways (Module 4) ----
    //
    // The website editor PUTs the WHOLE settings object on every save, so
    // `body.paymentGateways` is present even when the operator was editing
    // their logo. Both guards below must therefore fire on an actual CHANGE,
    // never on the client echoing back what it was already given — otherwise
    // a store that has not set up a gateway can never save anything on this
    // page at all. `activeGateway` has a default with isConfigured=false,
    // which is the state of every new store: the whole page 400'd before it
    // ever reached settings.save().
    if (body.paymentGateways) {
      const pg = body.paymentGateways;
      const currentActive = settings.paymentGateways?.activeGateway;
      const activeGatewayChanging =
        pg.activeGateway !== undefined && pg.activeGateway !== currentActive;
      const credentialsSubmitted = ["cashfree", "phonepe"].some((k) => pg[k]);

      if (activeGatewayChanging || credentialsSubmitted) {
        if (req.user?.role !== "Owner" && req.user?.role !== "owner" && req.user?.role !== "superadmin") {
          return next(createHttpError(403, "Only the Store Owner can configure payment gateways."));
        }
      }

      if (activeGatewayChanging && ["cashfree", "phonepe"].includes(pg.activeGateway)) {
        // A gateway may only be switched ON once it has credentials.
        const targetGw = settings.paymentGateways[pg.activeGateway];
        if (targetGw && targetGw.isConfigured !== false) {
          settings.paymentGateways.activeGateway = pg.activeGateway;
        } else {
          return next(createHttpError(400, `Cannot set ${pg.activeGateway} as active because it is not configured.`));
        }
      }

      for (const gwKey of ["cashfree", "phonepe"]) {
        if (pg[gwKey]) {
          const gw = pg[gwKey];
          const dest = settings.paymentGateways[gwKey] || {};

          if (gw.clientId !== undefined) dest.clientId = clampText(gw.clientId, 100);
          if (gw.merchantId !== undefined) dest.merchantId = clampText(gw.merchantId, 100);
          if (gw.saltIndex !== undefined) dest.saltIndex = clampText(gw.saltIndex, 10);
          if (gw.environment !== undefined && ["TEST", "PROD", "UAT"].includes(gw.environment)) {
            dest.environment = gw.environment;
          }

          // Secret masking security check (Module 4 §5): Store raw secret encrypted & masked representation
          const secretInput = gw.clientSecret || gw.saltKey;
          if (secretInput && typeof secretInput === "string" && !secretInput.includes("••••")) {
            const trimmedSecret = secretInput.trim();
            const masked = trimmedSecret.length > 4
              ? "••••••••" + trimmedSecret.slice(-4)
              : "••••••••";

            if (gwKey === "cashfree") {
              dest.clientSecretMasked = masked;
              dest.clientSecretEncrypted = seal(trimmedSecret);
            } else if (gwKey === "phonepe") {
              dest.saltKeyMasked = masked;
              dest.saltKeyEncrypted = seal(trimmedSecret);
            }
            dest.isConfigured = true;
          }

          settings.paymentGateways[gwKey] = dest;
        }
      }
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

    const domainChanged = body.customDomain !== undefined && body.customDomain !== prevSnapshot.customDomain;
    const activeGatewayChanged = body.paymentGateways?.activeGateway && body.paymentGateways.activeGateway !== prevSnapshot.paymentGateways?.activeGateway;
    const gatewayUpdated = Boolean(body.paymentGateways?.cashfree || body.paymentGateways?.phonepe);
    const homepageChanged = Boolean(body.banners || body.sectionTitles || body.branding || body.landing);

    settings.version += 1;
    settings.publishedAt = new Date();
    await settings.save();

    if (domainChanged) {
      await logActivity({
        req,
        action: "Domain Changed",
        resource: "Domain Configuration",
        previousValue: prevSnapshot.customDomain || "(none)",
        newValue: settings.customDomain || "(none)",
        description: `Custom domain changed from '${prevSnapshot.customDomain || "none"}' to '${settings.customDomain || "none"}'`,
      });
    }

    if (activeGatewayChanged) {
      await logActivity({
        req,
        action: "Active Payment Gateway Changed",
        resource: "Payment Gateway",
        previousValue: prevSnapshot.paymentGateways?.activeGateway || "cashfree",
        newValue: settings.paymentGateways?.activeGateway,
        description: `Active payment gateway changed from '${prevSnapshot.paymentGateways?.activeGateway || "cashfree"}' to '${settings.paymentGateways?.activeGateway}'`,
      });
    }

    if (gatewayUpdated && !activeGatewayChanged) {
      await logActivity({
        req,
        action: "Payment Gateway Credentials Updated",
        resource: "Payment Gateway",
        description: "Payment gateway credentials updated",
      });
    }

    if (homepageChanged) {
      await logActivity({
        req,
        action: "Homepage Content Changed",
        resource: "Website Homepage",
        description: "Homepage layout/branding/banners updated",
      });
    }

    if (!domainChanged && !activeGatewayChanged && !gatewayUpdated && !homepageChanged) {
      await logActivity({
        req,
        action: "Website Configuration Changed",
        resource: "Website Settings",
        previousValue: prevSnapshot,
        newValue: sanitizeSettings(settings),
        description: "Website settings updated",
      });
    }

    res.status(200).json({
      success: true,
      message: "Website settings updated",
      data: { settings: sanitizeSettings(settings), storefrontUrl: buildStorefrontUrl(settings) },
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

const validateGatewayCredentials = async (req, res, next) => {
  try {
    const { tenant, settings } = await loadOwnSettings(req);
    const { gateway, clientId, clientSecret, merchantId, saltKey, saltIndex, environment } = req.body || {};

    if (!["cashfree", "phonepe"].includes(gateway)) {
      return next(createHttpError(400, "Invalid payment gateway type!"));
    }

    let isVerified = false;
    let message = "";

    if (gateway === "cashfree") {
      if (!clientId || !clientSecret) {
        return next(createHttpError(400, "Cashfree Client ID and Client Secret are required!"));
      }
      // Actually ask Cashfree, rather than measuring the string length.
      //
      // "Validated successfully" used to mean nothing more than "both fields
      // are at least six characters", so a typo'd secret was saved as
      // verified and only failed later, in front of a customer at checkout.
      const probe = await require("../services/gateways/cashfree").verifyCredentials({
        appId: clientId,
        secretKey: clientSecret,
        environment: environment || "TEST",
      });
      if (!probe.ok) {
        return next(
          createHttpError(400, probe.reason || "Cashfree rejected these credentials."),
        );
      }
      isVerified = true;
      message = `Cashfree credentials verified against ${
        String(environment || "TEST").toUpperCase() === "PROD" ? "production" : "sandbox"
      }.`;
    } else if (gateway === "phonepe") {
      if (!merchantId || !saltKey) {
        return next(createHttpError(400, "PhonePe Merchant ID and Salt Key are required!"));
      }
      if (merchantId.length >= 4 && saltKey.length >= 6) {
        isVerified = true;
        message = "PhonePe credentials validated successfully!";
      } else {
        return next(createHttpError(400, "PhonePe credentials validation failed."));
      }
    }

    if (isVerified) {
      settings.paymentGateways = settings.paymentGateways || {};
      const secretInput = clientSecret || saltKey;
      const masked = secretInput.length > 4 ? "••••••••" + secretInput.trim().slice(-4) : "••••••••";

      // The *Encrypted fields held plain Base64 -- an encoding, not
      // encryption -- so anyone with read access to the database had the
      // plaintext secret. seal() encrypts with AES-256-GCM when
      // CREDENTIALS_SECRET is set, and falls back to the old Base64 when
      // it is not, so a missing key cannot take payments offline.
      const gwData = {
        clientId: clampText(clientId, 100) || "",
        clientSecretMasked: masked,
        clientSecretEncrypted: seal(secretInput.trim()),
        merchantId: clampText(merchantId, 100) || "",
        saltKeyMasked: masked,
        saltKeyEncrypted: seal(secretInput.trim()),
        saltIndex: clampText(saltIndex, 10) || "1",
        environment: environment || "TEST",
        isConfigured: true,
      };

      settings.paymentGateways[gateway] = gwData;
      if (!settings.paymentGateways.activeGateway) {
        settings.paymentGateways.activeGateway = gateway;
      }
      await settings.save();

      await logActivity({
        req,
        action: "Configured Payment Gateway",
        resource: "Payment Gateway",
        entityType: gateway,
        newValue: `${gateway.toUpperCase()} credentials validated & saved (${environment})`,
        description: `Configured payment gateway: ${gateway}`,
      });
    }

    res.status(200).json({
      success: true,
      message,
      data: { gateway, isConfigured: true, activeGateway: settings.paymentGateways.activeGateway },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getWebsiteSettings, updateWebsiteSettings, previewWebsite, validateGatewayCredentials, loadOwnSettings };
