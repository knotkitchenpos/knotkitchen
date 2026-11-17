const createHttpError = require("http-errors");
const Announcement = require("../models/announcementModel");
const { csdAudit } = require("../services/csdAuditService");

/**
 * Broadcast announcements (owner, 2026-11-17): CSD admins post, every POS
 * shows a banner (models/announcementModel.js).
 */

const LEVELS = ["info", "warning", "critical"];
const clip = (v, n) => String(v ?? "").trim().slice(0, n);
const httpsOrEmpty = (v) => {
  const s = clip(v, 500);
  return /^https:\/\/[^\s]+$/i.test(s) ? s : "";
};
const dateOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Which announcements a store sees right now. */
const activeFilter = (storeId, now = new Date()) => ({
  startsAt: { $lte: now },
  $and: [
    { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    { $or: [{ storeIds: { $size: 0 } }, { storeIds: String(storeId || "") }] },
  ],
});

const shape = (a) => ({
  id: String(a._id),
  title: a.title,
  body: a.body,
  level: a.level,
  linkUrl: a.linkUrl,
  linkLabel: a.linkLabel,
  storeIds: a.storeIds,
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  createdByName: a.createdByName,
  endedByName: a.endedByName,
  createdAt: a.createdAt,
});

/** Tell every open POS to look again (each one fetches only what is its own). */
const announceChange = () => {
  try {
    require("../services/socket").emitEvent("announcement:changed", {});
  } catch {
    /* no socket here: POS screens pick it up on their next load */
  }
};

// ---------------------------------------------------------------- POS ------

/** GET /api/announcements: what this store's POS should show now. */
const listActiveForStore = async (req, res, next) => {
  try {
    const rows = await Announcement.find(activeFilter(req.user?.storeId)).sort({ startsAt: -1 }).limit(5).lean();
    res.status(200).json({ success: true, data: rows.map(shape) });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------- CSD ------

/** GET /api/csd/announcements: the newest 100, live and ended. */
const listAll = async (req, res, next) => {
  try {
    const rows = await Announcement.find({}).sort({ createdAt: -1 }).limit(100).lean();
    res.status(200).json({ success: true, data: rows.map(shape) });
  } catch (err) {
    next(err);
  }
};

const readBody = (b = {}) => {
  const title = clip(b.title, 120);
  if (!title) throw createHttpError(400, "Enter a title.");
  const level = LEVELS.includes(b.level) ? b.level : "info";
  const linkUrl = httpsOrEmpty(b.linkUrl);
  if (clip(b.linkUrl, 500) && !linkUrl) throw createHttpError(400, "The link must start with https://");
  const storeIds = [...new Set((Array.isArray(b.storeIds) ? b.storeIds : String(b.storeIds || "").split(/[\s,]+/)).map((s) => String(s).trim()).filter(Boolean))];
  if (storeIds.some((s) => !/^\d{6}$/.test(s))) throw createHttpError(400, "Store IDs are 6 digits, separated by commas.");
  const startsAt = dateOrNull(b.startsAt);
  const endsAt = dateOrNull(b.endsAt);
  if (startsAt === undefined || endsAt === undefined) throw createHttpError(400, "That date is not valid.");
  if (startsAt && endsAt && endsAt <= startsAt) throw createHttpError(400, "The end must be after the start.");
  return { title, body: clip(b.body, 600), level, linkUrl, linkLabel: linkUrl ? clip(b.linkLabel, 40) : "", storeIds, startsAt: startsAt || new Date(), endsAt };
};

/** POST /api/csd/announcements */
const create = async (req, res, next) => {
  try {
    const a = await Announcement.create({ ...readBody(req.body), createdByName: req.csdStaff?.fullName || "" });
    await csdAudit({ req, staff: req.csdStaff, action: "CSD_ANNOUNCEMENT_POSTED", resource: "Announcement", entityType: "Announcement", entityId: a._id, description: `Announcement posted: ${a.title}${a.storeIds.length ? ` (stores ${a.storeIds.join(", ")})` : " (all stores)"}`, newValue: shape(a) }).catch(() => {});
    announceChange();
    res.status(201).json({ success: true, data: shape(a) });
  } catch (err) {
    next(err);
  }
};

/** POST /api/csd/announcements/:id/end: take it off every POS now. */
const end = async (req, res, next) => {
  try {
    const a = await Announcement.findById(req.params.id);
    if (!a) throw createHttpError(404, "Announcement not found.");
    if (!a.endsAt || a.endsAt > new Date()) {
      a.endsAt = new Date();
      a.endedByName = req.csdStaff?.fullName || "";
      await a.save();
      await csdAudit({ req, staff: req.csdStaff, action: "CSD_ANNOUNCEMENT_ENDED", resource: "Announcement", entityType: "Announcement", entityId: a._id, description: `Announcement ended: ${a.title}` }).catch(() => {});
      announceChange();
    }
    res.status(200).json({ success: true, data: shape(a) });
  } catch (err) {
    next(err);
  }
};

module.exports = { listActiveForStore, listAll, create, end, activeFilter, readBody };
