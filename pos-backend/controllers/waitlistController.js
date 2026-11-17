const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Waitlist = require("../models/waitlistModel");

/**
 * Waitlist for busy hours (owner, 2026-11-17): models/waitlistModel.js.
 * POS plan only (middlewares/planGate denies it on the Billing plan, like
 * tables). Every change is pushed to the store's tills ("waitlist:changed").
 */

const TEMPLATE = "kk_table_ready";
// {{1}} name, {{2}} party size, {{3}} restaurant.
const WORDING = "Hi {{1}}, your table for {{2}} at {{3}} is ready. Please come to the host desk.";
const ACTIVE = ["waiting", "notified"];

const rid = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};
const shape = (w) => ({
  id: String(w._id),
  name: w.name,
  phone: w.phone,
  partySize: w.partySize,
  note: w.note,
  status: w.status,
  addedAt: w.createdAt,
  notifiedAt: w.notifiedAt,
  notifiedByWhatsApp: w.notifiedByWhatsApp,
});
const changed = (restaurantId) => {
  try {
    require("../services/socket").emitToRestaurant(String(restaurantId), "waitlist:changed", {});
  } catch {
    /* no socket here: the other tills refresh on their next load */
  }
};

/** Name, phone (optional, 10 digits) and party size, checked. */
const readEntry = (b = {}) => {
  const name = String(b.name ?? "").trim().slice(0, 60);
  if (!name) throw createHttpError(400, "Enter the guest's name.");
  const phone = String(b.phone ?? "").replace(/\D/g, "").slice(-10);
  if (phone && !/^[6-9]\d{9}$/.test(phone)) throw createHttpError(400, "Enter a valid 10-digit phone, or leave it blank.");
  const partySize = Math.round(Number(b.partySize));
  if (!Number.isFinite(partySize) || partySize < 1 || partySize > 99) throw createHttpError(400, "Party size must be between 1 and 99.");
  return { name, phone, partySize, note: String(b.note ?? "").trim().slice(0, 120) };
};

/** GET /api/waitlist: who is waiting now, oldest first, and whether WhatsApp can tell them. */
const list = async (req, res, next) => {
  try {
    const rows = await Waitlist.find({ restaurantId: rid(req), status: { $in: ACTIVE } }).sort({ createdAt: 1 }).limit(200).lean();
    const wa = await require("../services/waTemplates").templateReady(TEMPLATE, 3);
    res.status(200).json({ success: true, data: { entries: rows.map(shape), whatsapp: { ready: wa.ready, reason: wa.reason || "", template: TEMPLATE, wording: WORDING } } });
  } catch (err) {
    next(err);
  }
};

/** POST /api/waitlist */
const add = async (req, res, next) => {
  try {
    const restaurantId = rid(req);
    const w = await Waitlist.create({ ...readEntry(req.body), restaurantId, addedByName: req.user?.name || "" });
    changed(restaurantId);
    res.status(201).json({ success: true, data: shape(w) });
  } catch (err) {
    next(err);
  }
};

const loadActive = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw createHttpError(404, "Not on the waitlist.");
  const w = await Waitlist.findOne({ _id: req.params.id, restaurantId: rid(req) });
  if (!w) throw createHttpError(404, "Not on the waitlist.");
  return w;
};

/** POST /api/waitlist/:id/notify: the table is ready. WhatsApp when it can, always recorded. */
const notify = async (req, res, next) => {
  try {
    const w = await loadActive(req);
    if (!ACTIVE.includes(w.status)) throw createHttpError(409, "This party is no longer waiting.");
    let result = { sent: false, reason: "No phone number." };
    if (w.phone) {
      const Restaurant = require("../models/restaurantModel");
      const r = await Restaurant.findById(w.restaurantId).select("name").lean();
      result = await require("../services/waTemplates").sendTemplate({
        name: TEMPLATE,
        values: [w.name, String(w.partySize), r?.name || "the restaurant"],
        phone: w.phone,
        actorName: "Waitlist",
      });
    }
    w.status = "notified";
    w.notifiedAt = new Date();
    w.notifiedByWhatsApp = Boolean(result.sent);
    await w.save();
    changed(w.restaurantId);
    res.status(200).json({ success: true, data: { ...shape(w), whatsapp: result } });
  } catch (err) {
    next(err);
  }
};

const finish = (status) => async (req, res, next) => {
  try {
    const w = await loadActive(req);
    if (ACTIVE.includes(w.status)) {
      w.status = status;
      w.doneAt = new Date();
      await w.save();
      changed(w.restaurantId);
    }
    res.status(200).json({ success: true, data: shape(w) });
  } catch (err) {
    next(err);
  }
};

module.exports = { list, add, notify, seat: finish("seated"), leave: finish("left"), readEntry, TEMPLATE, WORDING };
