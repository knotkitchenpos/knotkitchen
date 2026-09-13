const createHttpError = require("http-errors");
const WebsiteSettings = require("../models/websiteSettingsModel");
const MediaAsset = require("../models/mediaAssetModel");
const { csdAudit } = require("../services/csdAuditService");
const { settingsResponse, updateWebsiteSettings } = require("./websiteSettingsController");

/**
 * A restaurant's website design and ordering settings, edited from the CSD.
 *
 * Homepage & Branding, Landing Page, Colors & Fonts, Layout, Ordering Options
 * and Hours were taken out of the POS's Manage Website and are managed by
 * KnotKitchen support here instead, per restaurant.
 *
 * Writes go through the SAME whitelisted writer the POS used
 * (updateWebsiteSettings), aimed at the chosen store rather than the caller's
 * own, so every clamp, enum check and media-ownership rule still applies.
 * Only the CSD sections are passed through: the web address, custom domain
 * and payment gateway stay with the restaurant.
 */

const CSD_SECTIONS = ["branding", "sectionTitles", "banners", "landing", "theme", "ordering"];
const CHANNELS = ["collection", "delivery", "table"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const storeIdOf = (req) => {
  const id = String(req.params.storeId || "");
  if (!/^\d{6}$/.test(id)) throw createHttpError(400, "Store ID must be 6 digits.");
  return id;
};

const loadTarget = async (req) => {
  const storeId = storeIdOf(req);
  const settings = await WebsiteSettings.findOne({ storeId, isDeleted: { $ne: true } });
  if (!settings) throw createHttpError(404, "This store has no customer website yet.");
  return {
    settings,
    tenant: { storeId, restaurantId: settings.restaurantId, outletId: settings.outletId || null },
  };
};

/** Weekly hours for Collection / Delivery / Restaurant (table booking) time. */
const cleanChannelHours = (input) => {
  if (!input || typeof input !== "object") return null;
  const out = {};
  for (const channel of CHANNELS) {
    const weekly = input[channel]?.weekly;
    if (!Array.isArray(weekly)) continue;
    const byDay = new Map();
    for (const row of weekly) {
      const day = Number(row?.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      if (!HHMM.test(String(row.openTime || "")) || !HHMM.test(String(row.closeTime || ""))) {
        throw createHttpError(400, "Opening and closing times must be HH:MM.");
      }
      byDay.set(day, { day, isOpen: Boolean(row.isOpen), openTime: row.openTime, closeTime: row.closeTime });
    }
    out[channel] = [...byDay.values()].sort((a, b) => a.day - b.day);
  }
  return out;
};

/** GET /api/csd/restaurants/:storeId/website */
const getCsdWebsite = async (req, res, next) => {
  try {
    const { settings } = await loadTarget(req);
    res.status(200).json({
      success: true,
      data: { ...settingsResponse(settings), canEdit: req.csdStaff?.role === "admin" },
    });
  } catch (err) {
    next(err);
  }
};

/** PATCH /api/csd/restaurants/:storeId/website — admin only. */
const updateCsdWebsite = async (req, res, next) => {
  try {
    const target = await loadTarget(req);
    const body = req.body || {};

    const picked = {};
    for (const key of CSD_SECTIONS) if (body[key] !== undefined) picked[key] = body[key];

    const hours = cleanChannelHours(body.channelHours);
    if (hours) {
      for (const [channel, weekly] of Object.entries(hours)) {
        target.settings.set(`channelHours.${channel}.weekly`, weekly);
      }
    }

    const before = settingsResponse(target.settings).settings;
    req.websiteTarget = target;
    req.body = picked;

    // Audit only what actually saved.
    res.once("finish", () => {
      if (res.statusCode >= 400) return;
      csdAudit({
        req,
        staff: req.csdStaff,
        action: "CSD_WEBSITE_SETTINGS_UPDATED",
        resource: "WebsiteSettings",
        entityType: "WebsiteSettings",
        entityId: target.settings._id,
        storeId: target.tenant.storeId,
        description: `Website settings updated (${[...Object.keys(picked), ...(hours ? ["channelHours"] : [])].join(", ") || "no changes"})`,
        previousValue: before,
        newValue: settingsResponse(target.settings).settings,
      }).catch(() => {});
    });

    return updateWebsiteSettings(req, res, next);
  } catch (err) {
    next(err);
  }
};

/** GET /api/csd/restaurants/:storeId/website/media — the store's own image library. */
const listCsdWebsiteMedia = async (req, res, next) => {
  try {
    const storeId = storeIdOf(req);
    const rows = await MediaAsset.find({ storeId, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(300)
      .select("url thumbnailUrl folder altText createdAt")
      .lean();
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCsdWebsite, updateCsdWebsite, listCsdWebsiteMedia, cleanChannelHours };
