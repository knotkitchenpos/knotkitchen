const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Shift = require("../models/shiftModel");
const Order = require("../models/orderModel");
const { logActivity } = require("../services/auditService");
const { shiftSummary, closeFigures } = require("../services/shifts");

/**
 * Shifts and day-end.
 *
 * Open the till with a float, close it with a cash count. The orders of the
 * shift are whatever was placed between open and close for this restaurant
 * (or outlet), so nothing has to be tagged at order time.
 */

const scope = (user) => ({
  restaurantId: user.restaurantId,
  ...(user.outletId ? { outletId: user.outletId } : {}),
});

const ordersBetween = (user, from, to) =>
  Order.find({
    ...scope(user),
    isDeleted: { $ne: true },
    createdAt: { $gte: from, $lte: to || new Date() },
  })
    .select("orderStatus bills refunds payments paymentMethod")
    .lean();

const money = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return null;
  return Math.round(n * 100) / 100;
};

/** GET /api/shift/current -- the open shift with live figures, or null. */
const currentShift = async (req, res, next) => {
  try {
    if (!req.user?.restaurantId) return res.status(200).json({ success: true, data: null });
    const shift = await Shift.findOne({ ...scope(req.user), status: "open" }).sort({ openedAt: -1 }).lean();
    if (!shift) return res.status(200).json({ success: true, data: null });
    const orders = await ordersBetween(req.user, shift.openedAt);
    res.status(200).json({ success: true, data: { ...shift, live: shiftSummary(orders, shift.openingCash) } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/shift/open { openingCash } */
const openShift = async (req, res, next) => {
  try {
    if (!req.user?.restaurantId) return next(createHttpError(400, "No restaurant on this account."));
    const openingCash = money(req.body?.openingCash);
    if (openingCash === null) return next(createHttpError(400, "Opening cash must be a number, 0 or more."));
    const already = await Shift.findOne({ ...scope(req.user), status: "open" });
    if (already) return next(createHttpError(409, "A shift is already open. Close it first."));
    const shift = await Shift.create({
      ...scope(req.user),
      openingCash,
      openedBy: req.user?.name || "POS",
      openedAt: new Date(),
    });
    await logActivity({
      req,
      action: "Shift Opened",
      resource: "Shift",
      resourceId: shift._id,
      newValue: `Float ₹${openingCash.toFixed(2)}`,
      description: `Shift opened by ${shift.openedBy} with ₹${openingCash.toFixed(2)} in the drawer`,
    });
    res.status(201).json({ success: true, message: "Shift opened.", data: shift });
  } catch (error) {
    next(error);
  }
};

/** POST /api/shift/close { closingCash, note } */
const closeShift = async (req, res, next) => {
  try {
    const closingCash = money(req.body?.closingCash);
    if (closingCash === null) return next(createHttpError(400, "Counted cash must be a number, 0 or more."));
    const shift = await Shift.findOne({ ...scope(req.user), status: "open" }).sort({ openedAt: -1 });
    if (!shift) return next(createHttpError(409, "No shift is open."));

    const closedAt = new Date();
    const orders = await ordersBetween(req.user, shift.openedAt, closedAt);
    shift.summary = closeFigures(shiftSummary(orders, shift.openingCash), closingCash);
    shift.closingCash = closingCash;
    shift.closedAt = closedAt;
    shift.closedBy = req.user?.name || "POS";
    shift.note = String(req.body?.note || "").trim().slice(0, 300);
    shift.status = "closed";
    await shift.save();

    const d = shift.summary.difference;
    await logActivity({
      req,
      action: "Shift Closed",
      resource: "Shift",
      resourceId: shift._id,
      newValue: `Counted ₹${closingCash.toFixed(2)}, expected ₹${shift.summary.expectedCash.toFixed(2)} (${d >= 0 ? "+" : ""}${d.toFixed(2)})`,
      description: `Shift closed by ${shift.closedBy}: ${shift.summary.orders} orders, sales ₹${shift.summary.sales.toFixed(2)}`,
    });
    res.status(200).json({ success: true, message: "Shift closed.", data: shift });
  } catch (error) {
    next(error);
  }
};

/** GET /api/shift?limit=30 -- closed shifts, newest first. */
const listShifts = async (req, res, next) => {
  try {
    if (!req.user?.restaurantId) return res.status(200).json({ success: true, data: [] });
    const limit = Math.min(90, Math.max(1, Number(req.query.limit) || 30));
    const data = await Shift.find({ ...scope(req.user), status: "closed" }).sort({ closedAt: -1 }).limit(limit).lean();
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** GET /api/shift/:id -- one shift, with live figures if still open. */
const getShift = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(404, "Invalid id!"));
    const shift = await Shift.findOne({ _id: id, ...scope(req.user) }).lean();
    if (!shift) return next(createHttpError(404, "Shift not found!"));
    if (shift.status === "open") {
      const orders = await ordersBetween(req.user, shift.openedAt);
      shift.live = shiftSummary(orders, shift.openingCash);
    }
    res.status(200).json({ success: true, data: shift });
  } catch (error) {
    next(error);
  }
};

module.exports = { currentShift, openShift, closeShift, listShifts, getShift };
