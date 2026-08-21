const Table = require("../models/tableModel");
const TableSession = require("../models/tableSessionModel");
const createHttpError = require("http-errors");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { logActivity } = require("../services/auditService");

const addTable = async (req, res, next) => {
  try {
    const { tableNo, tableName, displayId, seats, capacity: capInput, area, floor, zone, isEnabled } = req.body;
    
    // Derive displayId or tableNo
    const finalDisplayId = String(displayId || tableName || (tableNo ? `Table-${tableNo}` : "")).trim();
    let tableNumber = Number(tableNo);

    // Scope query
    const scopeQuery = req.user?.restaurantId
      ? {
          restaurantId: req.user.restaurantId,
          ...(req.user.outletId ? { outletId: req.user.outletId } : {}),
        }
      : { createdBy: req.user._id };

    if (!Number.isInteger(tableNumber) || tableNumber < 1) {
      // Auto-generate numeric tableNumber if non-numeric displayId was given
      const maxTable = await Table.findOne({ ...scopeQuery, isDeleted: { $ne: true } }).sort({ tableNumber: -1 });
      tableNumber = (maxTable?.tableNumber || 0) + 1;
    }

    const capacity = Number(capInput || seats) || 4;
    if (!Number.isInteger(capacity) || capacity < 1) {
      const error = createHttpError(400, "Capacity must be at least 1 customer!");
      return next(error);
    }
    if (capacity > 100) {
      const error = createHttpError(400, "Capacity cannot exceed 100 customers!");
      return next(error);
    }

    const isTablePresent = await Table.findOne({
      ...scopeQuery,
      $or: [{ tableNumber }, ...(finalDisplayId ? [{ displayId: finalDisplayId }] : [])],
      isDeleted: { $ne: true },
    });

    if (isTablePresent) {
      const error = createHttpError(400, "Table with this identifier already exists!");
      return next(error);
    }

    const qrToken = crypto.randomBytes(24).toString("hex");
    const chosenArea = String(area || floor || zone || "Ground Floor").trim();

    const newTable = new Table({
      tableNumber,
      tableName: finalDisplayId || `Table-${tableNumber}`,
      displayId: finalDisplayId || `Table-${tableNumber}`,
      area: chosenArea,
      floor: chosenArea,
      zone: chosenArea,
      capacity,
      isEnabled: isEnabled !== false,
      restaurantId: req.user?.restaurantId,
      outletId: req.user?.outletId,
      createdBy: req.user._id,
      qrToken,
      qrCode: `${process.env.FRONTEND_URL || "http://localhost:5173"}/order?table=${qrToken}`,
      qrEnabled: true,
      status: "available",
    });
    await newTable.save();

    await logActivity({
      req,
      action: "Table Added",
      resource: "Table",
      entityType: "Table",
      entityId: newTable._id,
      newValue: { displayId: newTable.displayId, area: newTable.area, capacity: newTable.capacity },
      description: `Table added: ${newTable.displayId} (${newTable.area}, Capacity ${newTable.capacity})`,
    });

    res.status(201).json({ success: true, message: "Table added!", data: newTable });
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
    const { status, orderId, capacity, zone, area, floor, displayId, tableName, isEnabled } = req.body;
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

    if (req.body.currentOccupancy !== undefined && req.body.currentOccupancy !== null) {
      throw createHttpError(400, "Current occupancy is managed by the system and cannot be set directly!");
    }

    const table = await Table.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    const prevVal = {
      displayId: table.displayId,
      area: table.area,
      capacity: table.capacity,
      isEnabled: table.isEnabled,
    };

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
    const chosenArea = area || floor || zone;
    if (chosenArea) {
      updateFields.area = String(chosenArea).trim();
      updateFields.floor = String(chosenArea).trim();
      updateFields.zone = String(chosenArea).trim();
    }

    const newDisp = displayId || tableName;
    if (newDisp) {
      updateFields.displayId = String(newDisp).trim();
      updateFields.tableName = String(newDisp).trim();
    }

    if (typeof isEnabled === "boolean") {
      updateFields.isEnabled = isEnabled;
    }

    // Backend enforcement: capacity cannot be lowered below current occupancy
    if (updateFields.capacity !== undefined) {
      const currentOccupancy = table.currentOccupancy || 0;
      if (updateFields.capacity < currentOccupancy) {
        throw createHttpError(
          400,
          `Cannot reduce capacity below current occupancy of ${currentOccupancy} customer(s) on Table ${table.displayId || table.tableNumber}.`
        );
      }
    }

    const updatedTable = await Table.findOneAndUpdate(
      { _id: id, ...scopeQuery },
      updateFields,
      { new: true }
    );

    await logActivity({
      req,
      action: "Table Updated",
      resource: "Table",
      entityType: "Table",
      entityId: id,
      previousValue: prevVal,
      newValue: {
        displayId: updatedTable.displayId,
        area: updatedTable.area,
        capacity: updatedTable.capacity,
        isEnabled: updatedTable.isEnabled,
      },
      description: `Table updated: ${updatedTable.displayId}`,
    });

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

    const table = await Table.findOne({ _id: id, ...scopeQuery, isDeleted: { $ne: true } });
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    table.isDeleted = true;
    await table.save();

    await logActivity({
      req,
      action: "Table Deleted",
      resource: "Table",
      entityType: "Table",
      entityId: id,
      previousValue: { displayId: table.displayId, area: table.area },
      description: `Table deleted: ${table.displayId || table.tableNumber}`,
    });

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