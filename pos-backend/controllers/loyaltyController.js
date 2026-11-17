const createHttpError = require("http-errors");
const Restaurant = require("../models/restaurantModel");
const loyalty = require("../services/loyalty");

/** Loyalty points (owner, 2026-11-17): services/loyalty.js. */

const rid = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};

/** GET /api/restaurant/loyalty/lookup?phone= : a customer's balance at the till. */
const lookup = async (req, res, next) => {
  try {
    const phone = String(req.query.phone || "").replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) throw createHttpError(400, "Enter a valid 10-digit mobile number.");
    res.status(200).json({ success: true, data: await loyalty.lookup(rid(req), phone) });
  } catch (err) {
    next(err);
  }
};

/** GET /api/restaurant/loyalty */
const getSettings = async (req, res, next) => {
  try {
    const r = await Restaurant.findById(rid(req)).select("loyalty").lean();
    res.status(200).json({ success: true, data: loyalty.settingsOf(r) });
  } catch (err) {
    next(err);
  }
};

const num = (v, min, max, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw createHttpError(400, `${label} must be between ${min} and ${max}.`);
  return n;
};

/** PUT /api/restaurant/loyalty { enabled, earnPer100, pointValue, minRedeem, expiryMonths } */
const saveSettings = async (req, res, next) => {
  try {
    const b = req.body || {};
    const next_ = {
      enabled: Boolean(b.enabled),
      earnPer100: num(b.earnPer100, 0, 100, "Points per ₹100"),
      pointValue: num(b.pointValue, 0.01, 100, "₹ per point"),
      minRedeem: Math.round(num(b.minRedeem, 0, 100000, "Points needed to redeem")),
      expiryMonths: Math.round(num(b.expiryMonths, 0, 120, "Expiry (months)")),
    };
    const r = await Restaurant.findByIdAndUpdate(rid(req), { $set: { loyalty: next_ } }, { new: true }).select("loyalty").lean();
    res.status(200).json({ success: true, data: loyalty.settingsOf(r) });
  } catch (err) {
    next(err);
  }
};

module.exports = { lookup, getSettings, saveSettings };
