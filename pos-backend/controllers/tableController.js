const Table = require("../models/tableModel");
const TableSession = require("../models/tableSessionModel");
const createHttpError = require("http-errors");
const crypto = require("crypto");
const mongoose = require("mongoose");

const addTable = async (req, res, next) => {
  try {
    const { tableNo, seats, zone } = req.body;
    if (!tableNo) {
      const error = createHttpError(400, "Please provide table No!");
      return next(error);
    }

    const tableNumber = Number(tableNo);
    const capacity = Number(seats) || 4;
    if (!Number.isInteger(capacity) || capacity < 1) {
      const error = createHttpError(400, "Capacity must be at least 1 customer!");
      return next(error);
    }
    if (capacity > 100) {
      const error = createHttpError(400, "Capacity cannot exceed 100 customers!");
      return next(error);
    }

    // Scope: prefer restaurantId (multi-tenant), fall back to createdBy for legacy users
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };

    const isTablePresent = await Table.findOne({
      ...scopeQuery,
      tableNumber,
      isDeleted: { $ne: true },
    });

    if (isTablePresent) {
      const error = createHttpError(400, "Table already exist!");
      return next(error);
    }

    // Generate a secure non-guessable QR token
    const qrToken = crypto.randomBytes(24).toString("hex");

    const newTable = new Table({
      tableNumber,
      capacity,
      zone,
      restaurantId: req.user?.restaurantId,
      outletId: req.user?.outletId,
      createdBy: req.user._id,
      qrToken,
      qrCode: `${process.env.FRONTEND_URL || "http://localhost:5173"}/order?table=${qrToken}`,
      qrEnabled: true,
      status: "available",
    });
    await newTable.save();
    res
      .status(201)
      .json({ success: true, message: "Table added!", data: newTable });
  } catch (error) {
    next(error);
  }
};

const getTables = async (req, res, next) => {
  try {
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
          isDeleted: { $ne: true },
        }
      : { createdBy: req.user._id, isDeleted: { $ne: true } };

    const tables = await Table.find(scopeQuery).sort({ tableNumber: 1 });

    // Attach active session info per table for the table grid UI
    const activeSessions = await TableSession.find({
      ...scopeQuery,
      status: {
        $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"],
      },
      isDeleted: { $ne: true },
    });

    const sessionMap = {};
    activeSessions.forEach((s) => {
      sessionMap[s.tableId.toString()] = s;
    });

    const result = tables.map((t) => {
      const tObj = t.toObject();
      const session = sessionMap[t._id.toString()];
      if (session) {
        tObj.session = {
          _id: session._id,
          sessionCode: session.sessionCode,
          status: session.status,
          customerCount: session.customerCount,
          bills: session.bills,
          itemsCount: session.items.length,
          createdAt: session.createdAt,
          customerName: session.customerName,
          customerPhone: session.customerPhone,
        };
        tObj.status = session.status.toLowerCase() === "occupied"
          ? "occupied"
          : session.status === "BILL_REQUESTED"
          ? "occupied"
          : session.status === "PAYMENT_PENDING"
          ? "occupied"
          : tObj.status;
      }
      return tObj;
    });

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getTableById = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };
    const table = await Table.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!table) throw createHttpError(404, "Table not found!");

    const activeSession = await TableSession.findOne({
      tableId: table._id,
      status: {
        $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"],
      },
      isDeleted: { $ne: true },
    });

    res.status(200).json({ success: true, data: { table, activeSession } });
  } catch (error) {
    next(error);
  }
};

const updateTable = async (req, res, next) => {
  try {
    const { status, orderId, capacity, zone } = req.body;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };

    // Reject client-supplied currentOccupancy: occupancy is server-managed
    if (req.body.currentOccupancy !== undefined && req.body.currentOccupancy !== null) {
      throw createHttpError(400, "Current occupancy is managed by the system and cannot be set directly!");
    }

    const updateFields = {};
    if (status) {
      const allowed = ["available", "occupied", "reserved", "cleaning"];
      if (!allowed.includes(status)) throw createHttpError(400, "Invalid table status!");
      updateFields.status = status;
    }
    if (orderId) updateFields.currentOrderId = orderId;
    if (capacity) {
      const cap = Number(capacity);
      if (cap < 1 || cap > 100) throw createHttpError(400, "Capacity must be between 1 and 100!");
      updateFields.capacity = cap;
    }
    if (zone) updateFields.zone = zone;

    const table = await Table.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    // Backend enforcement: a table's capacity can never be lowered below its current occupancy
    if (updateFields.capacity !== undefined) {
      const currentOccupancy = table.currentOccupancy || 0;
      if (updateFields.capacity < currentOccupancy) {
        throw createHttpError(
          400,
          `Cannot reduce capacity below current occupancy of ${currentOccupancy} customer(s) on Table ${table.tableNumber}.`
        );
      }
    }

    const updatedTable = await Table.findOneAndUpdate(
      { _id: id, ...scopeQuery },
      updateFields,
      { new: true }
    );

    if (!updatedTable) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    res.status(200).json({ success: true, message: "Table updated!", data: updatedTable });
  } catch (error) {
    next(error);
  }
};

const deleteTable = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };

    // Prevent deletion while active session exists
    const activeSession = await TableSession.findOne({
      tableId: id,
      status: { $in: ["OPEN", "OCCUPIED", "PROCESSING", "BILL_REQUESTED", "PAYMENT_PENDING"] },
      isDeleted: { $ne: true },
    });
    if (activeSession) {
      const error = createHttpError(400, "Cannot delete a table with an active session. Close the session first.");
      return next(error);
    }

    const table = await Table.findOneAndDelete({ _id: id, ...scopeQuery });
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Table deleted!", data: table });
  } catch (error) {
    next(error);
  }
};

// Regenerate secure QR token
const regenerateQr = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };

    const qrToken = crypto.randomBytes(24).toString("hex");
    const table = await Table.findOneAndUpdate(
      { _id: id, ...scopeQuery },
      {
        qrToken,
        qrCode: `${process.env.FRONTEND_URL || "http://localhost:5173"}/order?table=${qrToken}`,
        qrEnabled: true,
      },
      { new: true }
    );
    if (!table) throw createHttpError(404, "Table not found!");
    res.status(200).json({ success: true, message: "QR code regenerated!", data: table });
  } catch (error) {
    next(error);
  }
};

module.exports = { addTable, getTables, getTableById, updateTable, deleteTable, regenerateQr };