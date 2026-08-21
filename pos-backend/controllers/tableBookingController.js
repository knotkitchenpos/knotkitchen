const createHttpError = require("http-errors");
const TableBooking = require("../models/tableBookingModel");
const Table = require("../models/tableModel");
const TableSession = require("../models/tableSessionModel");
const { resolveStorefront, REASON_MESSAGES } = require("../services/storefrontResolver");

const generateBookingId = () => `TB-${Math.floor(100000 + Math.random() * 900000)}`;

/**
 * Public Customer Table Booking Endpoint (§Website Module 7).
 * POST /api/storefront/:slug/table-bookings
 */
const createPublicTableBooking = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const host = req.headers.host;
    const body = req.body || {};

    const ctx = await resolveStorefront({ identifier: slug, host });
    if (!ctx.ok) {
      return next(createHttpError(ctx.status || 404, REASON_MESSAGES[ctx.reason] || "Store not found."));
    }

    const { settings, restaurantId, storeId, outletId } = ctx;

    if (settings.ordering?.tableBookingEnabled === false) {
      return next(createHttpError(409, "Table booking is not enabled for this restaurant."));
    }

    const name = String(body.name || "").trim().slice(0, 120);
    const phone = String(body.phone || "").replace(/\D/g, "").slice(0, 15);
    const email = String(body.email || "").trim().slice(0, 160);
    const guestCount = Math.floor(Number(body.guestCount));

    if (!name) return next(createHttpError(400, "Customer name is required."));
    if (phone.length < 7) return next(createHttpError(400, "Valid phone number is required."));
    if (!Number.isFinite(guestCount) || guestCount < 1) {
      return next(createHttpError(400, "Valid guest count is required."));
    }

    if (!body.bookingDate || !body.bookingTime) {
      return next(createHttpError(400, "Booking date and time are required."));
    }

    const bookingDate = new Date(body.bookingDate);
    if (Number.isNaN(bookingDate.getTime())) {
      return next(createHttpError(400, "Invalid booking date."));
    }

    const bookingTime = String(body.bookingTime).trim();
    const requestedArea = String(body.requestedArea || "").trim();

    let targetTable = null;

    // Specific Table Selected (e.g. GF-T1)
    if (body.tableId || body.tableDisplayId || body.tableNumber) {
      const tableQuery = { restaurantId, isDeleted: { $ne: true } };
      if (body.tableId) tableQuery._id = body.tableId;
      else if (body.tableDisplayId) tableQuery.displayId = String(body.tableDisplayId).trim();
      else if (body.tableNumber) tableQuery.tableNumber = Number(body.tableNumber);

      targetTable = await Table.findOne(tableQuery);

      if (!targetTable) {
        return next(createHttpError(404, "Requested table not found."));
      }

      if (targetTable.isEnabled === false) {
        return next(createHttpError(409, `Table ${targetTable.displayId || targetTable.tableNumber} is currently disabled.`));
      }

      if (guestCount > targetTable.capacity) {
        return next(
          createHttpError(
            400,
            `Table ${targetTable.displayId || targetTable.tableNumber} has a maximum capacity of ${targetTable.capacity} guests.`
          )
        );
      }

      // Backend Double Booking Prevention: check existing active session or confirmed/pending booking
      const activeSession = await TableSession.findOne({
        tableId: targetTable._id,
        status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
        isDeleted: { $ne: true },
      });

      if (activeSession) {
        return next(createHttpError(409, `Table ${targetTable.displayId || targetTable.tableNumber} has an active order/session.`));
      }

      const existingBooking = await TableBooking.findOne({
        tableId: targetTable._id,
        bookingDate,
        bookingTime,
        status: { $in: ["CONFIRMED", "PENDING"] },
        isDeleted: { $ne: true },
      });

      if (existingBooking) {
        return next(createHttpError(409, `Table ${targetTable.displayId || targetTable.tableNumber} is already booked for ${bookingTime}.`));
      }
    } else if (requestedArea) {
      // Area selected without specific table — verify at least one table in area has sufficient capacity
      const suitableTable = await Table.findOne({
        restaurantId,
        area: requestedArea,
        capacity: { $gte: guestCount },
        isEnabled: { $ne: false },
        isDeleted: { $ne: true },
      });

      if (!suitableTable) {
        return next(createHttpError(409, `No available table in ${requestedArea} with capacity for ${guestCount} guests.`));
      }
    }

    const bookingId = generateBookingId();

    const booking = await TableBooking.create({
      bookingId,
      restaurantId,
      outletId,
      storeId,
      customerDetails: { name, phone, email },
      guestCount,
      bookingDate,
      bookingTime,
      requestedArea,
      tableId: targetTable ? targetTable._id : null,
      tableDisplayId: targetTable ? (targetTable.displayId || `Table ${targetTable.tableNumber}`) : "",
      status: "PENDING",
    });

    res.status(201).json({
      success: true,
      message: "Table booking request submitted successfully",
      data: {
        bookingId: booking.bookingId,
        status: booking.status,
        guestCount: booking.guestCount,
        bookingDate: booking.bookingDate,
        bookingTime: booking.bookingTime,
        tableDisplayId: booking.tableDisplayId,
        requestedArea: booking.requestedArea,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POS Staff Accept Booking Endpoint (§Website Module 7).
 * POST /api/table/bookings/:id/accept
 */
const acceptTableBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId;

    if (!restaurantId) return next(createHttpError(401, "Unauthorized access."));

    const booking = await TableBooking.findOne({
      _id: id,
      restaurantId,
      isDeleted: { $ne: true },
    });

    if (!booking) return next(createHttpError(404, "Booking not found."));

    if (booking.status !== "PENDING") {
      return next(createHttpError(400, `Booking is already ${booking.status.toLowerCase()}.`));
    }

    let assignedTable = null;
    const bodyTableId = req.body?.tableId;

    if (booking.tableId) {
      // Re-verify availability immediately before acceptance
      assignedTable = await Table.findOne({
        _id: booking.tableId,
        restaurantId,
        isDeleted: { $ne: true },
      });

      if (!assignedTable || assignedTable.isEnabled === false) {
        return next(createHttpError(409, "Requested table is no longer available."));
      }

      const activeSession = await TableSession.findOne({
        tableId: assignedTable._id,
        status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
        isDeleted: { $ne: true },
      });

      if (activeSession) {
        return next(createHttpError(409, `Table ${assignedTable.displayId || assignedTable.tableNumber} is currently occupied.`));
      }
    } else if (bodyTableId) {
      // Staff selected table for "No specific table" request
      assignedTable = await Table.findOne({
        _id: bodyTableId,
        restaurantId,
        isDeleted: { $ne: true },
      });

      if (!assignedTable) return next(createHttpError(404, "Selected table not found."));

      if (assignedTable.capacity < booking.guestCount) {
        return next(
          createHttpError(
            400,
            `Table ${assignedTable.displayId || assignedTable.tableNumber} capacity (${assignedTable.capacity}) is less than guest count (${booking.guestCount}).`
          )
        );
      }
    } else {
      // Auto-assign first available table matching capacity & area
      const query = {
        restaurantId,
        capacity: { $gte: booking.guestCount },
        isEnabled: { $ne: false },
        isDeleted: { $ne: true },
      };
      if (booking.requestedArea) query.area = booking.requestedArea;

      assignedTable = await Table.findOne(query);

      if (!assignedTable) {
        return next(createHttpError(409, `No suitable table available for ${booking.guestCount} guests. Please assign a table manually.`));
      }
    }

    booking.status = "CONFIRMED";
    booking.tableId = assignedTable._id;
    booking.tableDisplayId = assignedTable.displayId || `Table ${assignedTable.tableNumber}`;
    booking.assignedBy = req.user._id;
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Table booking confirmed successfully",
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POS Staff Cancel/Reject Booking Endpoint (§Website Module 7).
 * POST /api/table/bookings/:id/cancel
 */
const cancelTableBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurantId = req.user?.restaurantId;
    const reason = String(req.body?.reason || "").trim() || "No suitable table available.";

    if (!restaurantId) return next(createHttpError(401, "Unauthorized access."));

    const booking = await TableBooking.findOne({
      _id: id,
      restaurantId,
      isDeleted: { $ne: true },
    });

    if (!booking) return next(createHttpError(404, "Booking not found."));

    booking.status = "REJECTED";
    booking.rejectionReason = reason;
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Table booking cancelled/rejected",
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POS Staff List Bookings Endpoint.
 * GET /api/table/bookings
 */
const listTableBookings = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return next(createHttpError(401, "Unauthorized access."));

    // .lean() returns plain JS objects (2-5x faster + less memory) since we
    // only read/serialize the booking list (no mongoose method calls needed).
    const bookings = await TableBooking.find({
      restaurantId,
      isDeleted: { $ne: true },
    })
      .sort({ bookingDate: -1, createdAt: -1 })
      .limit(200) // Cap heavy result sets; pagination reserved for future admin UI.
      .lean();

    res.status(200).json({
      success: true,
      data: bookings,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPublicTableBooking,
  acceptTableBooking,
  cancelTableBooking,
  listTableBookings,
};
