const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const TableBooking = require("../models/tableBookingModel");
const Table = require("../models/tableModel");
const TableSession = require("../models/tableSessionModel");
const Restaurant = require("../models/restaurantModel");
const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");
const {
  DEFAULT_TZ,
  bookingConfig,
  zonedInstant,
  bookableDates,
  slotsFor,
  blockWindow,
  overlappingBlockQuery,
  formatTime,
} = require("../services/tableBookings");
const { availabilityAt, windowsOn } = require("../services/websiteAvailability");

/**
 * Bookable times on a date: the booking slot grid, kept to Restaurant Time
 * for that date and to times the website is open (not a holiday, not closed
 * for today).
 */
const openSlots = (settings, config, date, timeZone) =>
  slotsFor(config, date, { timeZone }).filter((time) =>
    availabilityAt(settings, "table", zonedInstant(date, time, timeZone), timeZone).open,
  );

/** "4:00 PM – 10:00 PM" for a date, from Restaurant Time when it is set. */
const hoursLabelFor = (settings, config, date) => {
  const windows = windowsOn(settings, "table", date);
  if (windows === null) return `${formatTime(config.openTime)} – ${formatTime(config.closeTime)}`;
  if (!windows.length) return "Closed";
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return windows.map((w) => `${formatTime(hhmm(w.from))} – ${formatTime(hhmm(w.to))}`).join(", ");
};

// Lazy: services/socket pulls in the HTTP server.
const getSocket = () => require("../services/socket");

const LIVE_SESSION_STATUSES = ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"];

const generateBookingId = () => `TB-${Math.floor(100000 + Math.random() * 900000)}`;

const tableName = (t) => String(t?.displayId || t?.tableName || "").trim() || `Table ${t?.tableNumber ?? ""}`.trim();

const emit = (restaurantId, event, booking) => {
  try {
    getSocket().emitToRestaurant(restaurantId, event, { booking: toPosBooking(booking) });
  } catch (err) {
    console.warn(`[tableBooking] ${event} emit failed:`, err.message);
  }
};

const toPosBooking = (b) => {
  const o = b?.toObject ? b.toObject() : b;
  return {
    _id: String(o._id),
    bookingId: o.bookingId,
    status: o.status,
    name: o.customerDetails?.name || "",
    phone: o.customerDetails?.phone || "",
    guestCount: o.guestCount,
    bookingDate: o.bookingDate,
    bookingTime: o.bookingTime,
    timeLabel: formatTime(o.bookingTime),
    startAt: o.startAt,
    tableId: o.tableId ? String(o.tableId) : null,
    tableDisplayId: o.tableDisplayId || "",
    blockFrom: o.blockFrom,
    blockUntil: o.blockUntil,
    createdAt: o.createdAt,
  };
};

/**
 * The confirmed booking that holds `tableId` right now, if any.
 *
 * Used wherever a new order could start on a table (POS and QR): a table
 * promised to someone at 5:00 PM stops taking new parties from its block
 * start, not from 5:00 PM.
 */
const findActiveBlock = async (tableId, now = new Date()) => {
  if (!tableId) return null;
  return TableBooking.findOne(overlappingBlockQuery({ tableId, from: now, until: new Date(now.getTime() + 1) }));
};

/** The 409 a blocked table answers with. */
const blockedError = (booking, table) =>
  createHttpError(
    409,
    `${table ? tableName(table) : booking.tableDisplayId || "This table"} is pre-booked for ${booking.customerDetails?.name || "a guest"} at ${formatTime(booking.bookingTime)}. Seat the booking or cancel it in Manage Tables first.`,
  );

// ===========================================================================
// Public (restaurant website)
// ===========================================================================

const resolvePublicStore = async (req) => {
  const ctx = await resolveStorefront({ identifier: req.params.slug, host: req.headers.host });
  if (!ctx.ok) throw createHttpError(ctx.status || 404, REASON_MESSAGES[ctx.reason] || "Store not found.");
  return ctx;
};

/**
 * GET /api/storefront/:slug/table-bookings/slots?date=YYYY-MM-DD
 * Booking hours plus the times still bookable on the chosen day.
 */
const getPublicBookingSlots = async (req, res, next) => {
  try {
    const ctx = await resolvePublicStore(req);
    const config = bookingConfig(ctx.settings);
    const timeZone = ctx.timezone || DEFAULT_TZ;
    const dates = bookableDates(new Date(), timeZone);
    const date = dates.includes(req.query.date) ? req.query.date : dates[0];
    // Closed for Today or a holiday closes the whole website, bookings included.
    const now = availabilityAt(ctx.settings, "table", new Date(), timeZone);
    const websiteClosed = now.kind === "holiday" || now.kind === "closedToday";

    res.status(200).json({
      success: true,
      data: {
        enabled: config.enabled && !websiteClosed,
        closedReason: websiteClosed ? now.reason : "",
        openTime: config.openTime,
        closeTime: config.closeTime,
        hoursLabel: hoursLabelFor(ctx.settings, config, date),
        dates,
        date,
        slots: config.enabled && !websiteClosed ? openSlots(ctx.settings, config, date, timeZone) : [],
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/storefront/:slug/table-bookings
 * body: { date, time, guestCount, name, phone }
 */
const createPublicTableBooking = async (req, res, next) => {
  try {
    const ctx = await resolvePublicStore(req);
    const { settings, restaurantId, storeId, outletId } = ctx;
    const config = bookingConfig(settings);
    const timeZone = ctx.timezone || DEFAULT_TZ;
    const body = req.body || {};

    if (!config.enabled) throw createHttpError(409, "Table booking is not available for this restaurant.");
    const rightNow = availabilityAt(settings, "table", new Date(), timeZone);
    if (rightNow.kind === "holiday" || rightNow.kind === "closedToday") throw createHttpError(409, rightNow.reason);

    const name = String(body.name || "").trim().slice(0, 120);
    const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
    const guestCount = Math.floor(Number(body.guestCount));
    const date = String(body.date || "");
    const time = String(body.time || "");

    if (!name) throw createHttpError(400, "Please enter your name.");
    if (!/^[6-9]\d{9}$/.test(phone)) throw createHttpError(400, "Please enter a valid 10-digit phone number.");
    if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > 100) {
      throw createHttpError(400, "Please choose the number of guests.");
    }
    if (!bookableDates(new Date(), timeZone).includes(date)) {
      throw createHttpError(400, "Please choose a date within the next 7 days.");
    }
    if (!openSlots(settings, config, date, timeZone).includes(time)) {
      throw createHttpError(400, `Please choose an available time. Booking hours that day: ${hoursLabelFor(settings, config, date)}.`);
    }

    const booking = await TableBooking.create({
      bookingId: generateBookingId(),
      restaurantId,
      outletId,
      storeId,
      customerDetails: { name, phone },
      guestCount,
      bookingDate: date,
      bookingTime: time,
      startAt: zonedInstant(date, time, timeZone),
      status: "PENDING",
    });

    emit(restaurantId, "tableBooking:created", booking);

    res.status(201).json({
      success: true,
      message: "Booking request sent. The restaurant will confirm it shortly.",
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        guestCount: booking.guestCount,
        date: booking.bookingDate,
        time: booking.bookingTime,
        timeLabel: formatTime(booking.bookingTime),
      },
    });
  } catch (error) {
    next(error);
  }
};

// ===========================================================================
// POS
// ===========================================================================

const loadBooking = async (req) => {
  const restaurantId = req.user?.restaurantId;
  if (!restaurantId) throw createHttpError(401, "Unauthorized access.");
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) throw createHttpError(404, "Booking not found.");
  const booking = await TableBooking.findOne({ _id: req.params.id, restaurantId, isDeleted: { $ne: true } });
  if (!booking) throw createHttpError(404, "Booking not found.");
  return booking;
};

const posConfig = async (req) => {
  const WebsiteSettings = require("../models/websiteSettingsModel");
  const [settings, restaurant] = await Promise.all([
    WebsiteSettings.findOne({ restaurantId: req.user.restaurantId, isDeleted: { $ne: true } }).lean(),
    Restaurant.findById(req.user.restaurantId).select("timezone").lean(),
  ]);
  return { config: bookingConfig(settings), timeZone: restaurant?.timezone || DEFAULT_TZ };
};

const tableScope = (req) => ({
  restaurantId: req.user.restaurantId,
  ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
  isDeleted: { $ne: true },
});

/**
 * Whether `table` can be pre-booked for `booking`'s window.
 * Returns "" when it can, otherwise the reason it cannot.
 */
const unavailableReason = async (table, booking, window, now = new Date()) => {
  if (table.isEnabled === false) return "Disabled";
  if (Number(table.capacity) < booking.guestCount) return `Seats ${table.capacity}`;
  const clash = await TableBooking.findOne({
    ...overlappingBlockQuery({ tableId: table._id, from: window.blockFrom, until: window.blockUntil }),
    _id: { $ne: booking._id },
  });
  if (clash) return `Booked ${formatTime(clash.bookingTime)}`;
  // A party eating now only matters if the block starts before they could
  // reasonably be gone -- i.e. it has already begun.
  if (window.blockFrom <= now) {
    const live = await TableSession.findOne({ tableId: table._id, status: { $in: LIVE_SESSION_STATUSES }, isDeleted: { $ne: true } });
    if (live) return "Occupied";
  }
  return "";
};

/** GET /api/table-bookings — pending requests and confirmed bookings still ahead. */
const listTableBookings = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) throw createHttpError(401, "Unauthorized access.");
    const now = new Date();
    const bookings = await TableBooking.find({
      restaurantId,
      isDeleted: { $ne: true },
      $or: [
        { status: "PENDING", startAt: { $gt: new Date(now.getTime() - 6 * 3600000) } },
        { status: "CONFIRMED", blockUntil: { $gt: now } },
      ],
    })
      .sort({ startAt: 1 })
      .limit(200)
      .lean();
    res.status(200).json({ success: true, data: bookings.map(toPosBooking) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/table-bookings/:id/tables — every table, marked free or not for this booking's time. */
const listBookableTables = async (req, res, next) => {
  try {
    const booking = await loadBooking(req);
    const { config } = await posConfig(req);
    const window = blockWindow(booking.startAt, config);
    const tables = await Table.find(tableScope(req)).sort({ tableNumber: 1 }).lean();
    const now = new Date();
    const data = [];
    for (const t of tables) {
      const reason = await unavailableReason(t, booking, window, now);
      data.push({
        _id: String(t._id),
        name: tableName(t),
        capacity: t.capacity,
        area: t.area || "",
        available: !reason,
        reason,
      });
    }
    res.status(200).json({
      success: true,
      data: { booking: toPosBooking(booking), blockFrom: window.blockFrom, blockUntil: window.blockUntil, tables: data },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/table-bookings/:id/accept — body: { tableId } */
const acceptTableBooking = async (req, res, next) => {
  try {
    const booking = await loadBooking(req);
    if (booking.status !== "PENDING") throw createHttpError(400, `This booking is already ${booking.status.toLowerCase()}.`);
    if (!mongoose.Types.ObjectId.isValid(req.body?.tableId)) throw createHttpError(400, "Choose a table to pre-book.");

    const table = await Table.findOne({ _id: req.body.tableId, ...tableScope(req) });
    if (!table) throw createHttpError(404, "Table not found.");

    const { config } = await posConfig(req);
    const window = blockWindow(booking.startAt, config);
    const reason = await unavailableReason(table, booking, window);
    if (reason) throw createHttpError(409, `${tableName(table)} is not available for ${formatTime(booking.bookingTime)} (${reason}).`);

    booking.status = "CONFIRMED";
    booking.tableId = table._id;
    booking.tableDisplayId = tableName(table);
    booking.blockFrom = window.blockFrom;
    booking.blockUntil = window.blockUntil;
    booking.assignedBy = req.user._id;
    await booking.save();

    emit(booking.restaurantId, "tableBooking:updated", booking);
    res.status(200).json({ success: true, message: `${tableName(table)} pre-booked for ${formatTime(booking.bookingTime)}.`, data: toPosBooking(booking) });
  } catch (error) {
    next(error);
  }
};

/** POST /api/table-bookings/:id/cancel — a pending request is rejected, a confirmed one cancelled. */
const cancelTableBooking = async (req, res, next) => {
  try {
    const booking = await loadBooking(req);
    if (!["PENDING", "CONFIRMED"].includes(booking.status)) {
      throw createHttpError(400, `This booking is already ${booking.status.toLowerCase()}.`);
    }
    booking.status = booking.status === "PENDING" ? "REJECTED" : "CANCELLED";
    booking.rejectionReason = String(req.body?.reason || "").trim().slice(0, 200);
    booking.closedBy = req.user._id;
    booking.closedAt = new Date();
    await booking.save();

    emit(booking.restaurantId, "tableBooking:updated", booking);
    res.status(200).json({ success: true, message: "Booking cancelled.", data: toPosBooking(booking) });
  } catch (error) {
    next(error);
  }
};

/** POST /api/table-bookings/:id/seat — the party arrived; release the block so staff can order. */
const seatTableBooking = async (req, res, next) => {
  try {
    const booking = await loadBooking(req);
    if (booking.status !== "CONFIRMED") throw createHttpError(400, "Only a confirmed booking can be seated.");
    booking.status = "SEATED";
    booking.closedBy = req.user._id;
    booking.closedAt = new Date();
    await booking.save();

    emit(booking.restaurantId, "tableBooking:updated", booking);
    res.status(200).json({ success: true, message: "Guests seated. The table is free for their order.", data: toPosBooking(booking) });
  } catch (error) {
    next(error);
  }
};

/**
 * Upcoming confirmed bookings for a set of tables, keyed by table id --
 * the nearest one per table. For decorating the table grid.
 */
const upcomingBookingsByTable = async (tableIds, now = new Date()) => {
  const rows = await TableBooking.find({
    tableId: { $in: tableIds },
    status: "CONFIRMED",
    isDeleted: { $ne: true },
    blockUntil: { $gt: now },
  })
    .sort({ startAt: 1 })
    .lean();
  const map = {};
  for (const b of rows) {
    const key = String(b.tableId);
    if (!map[key]) map[key] = { ...toPosBooking(b), blocking: new Date(b.blockFrom) <= now };
  }
  return map;
};

module.exports = {
  getPublicBookingSlots,
  createPublicTableBooking,
  listTableBookings,
  listBookableTables,
  acceptTableBooking,
  cancelTableBooking,
  seatTableBooking,
  findActiveBlock,
  blockedError,
  formatTimeOf: (booking) => formatTime(booking?.bookingTime),
  upcomingBookingsByTable,
};
