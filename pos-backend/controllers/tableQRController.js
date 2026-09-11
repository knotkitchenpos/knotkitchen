const crypto = require("crypto");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const TableQR = require("../models/tableQRModel");
const Table = require("../models/tableModel");

/**
 * Generate a cryptographically-secure, non-guessable QR token.
 * 256 bits of entropy — impossible to enumerate.
 */
const generateSecureToken = () => crypto.randomBytes(32).toString("hex");

const FRONTEND_URL = () => process.env.FRONTEND_URL || "http://localhost:5173";

/**
 * The short host printed on the table: `https://order.<base>/<token>`.
 *
 * This URL is the QR code. Once a card is printed and glued to a table it can
 * never be edited, so it is worth it being the shortest, most legible thing it
 * can be -- `business.knotkitchen.com/t/<64 hex>` spends a third of the code's
 * capacity announcing the POS to a diner who does not care.
 *
 * The rewrite lives in Caddy: the `order.` vhost maps `/<token>` back onto the
 * `/t/<token>` route the POS SPA already serves, so every card already printed
 * under the long form keeps scanning.
 *
 * Unset falls back to the long form, so a deployment without the vhost still
 * generates a QR that works.
 */
const QR_PUBLIC_URL = () => String(process.env.QR_PUBLIC_URL || "").replace(/\/+$/, "");

const buildQrUrl = (token) => {
  const short = QR_PUBLIC_URL();
  return short ? `${short}/${token}` : `${FRONTEND_URL()}/t/${token}`;
};

/**
 * Hand back a QR with its URL rebuilt from the token, never the stored string.
 *
 * `qrUrl` is a stored copy of something derived: host plus token. The token is
 * the durable half -- it is what the QR encodes and what resolves the table --
 * and the host is deployment config that changes underneath it. Returning the
 * stored copy meant every QR minted before a host change kept serving the old
 * URL forever, because nothing ever recomputes it: the short-link hosts went
 * live and all thirteen existing tables went on printing the POS hostname.
 *
 * Rebuilding on read makes the stored field a cache rather than the truth, so
 * a host change reaches every table at once. The row is still written on
 * create, for the legacy `table.qrCode` readers.
 */
const withQrUrl = (qr) => {
  const plain = qr?.toObject ? qr.toObject() : { ...qr };
  return { ...plain, qrUrl: plain.token ? buildQrUrl(plain.token) : plain.qrUrl || "" };
};

/**
 * Resolve the restaurant/outlet scope from the authenticated user.
 * Built-in tenant isolation — the user's restaurantId/outletId are
 * trusted (they come from the verified JWT), never the request body.
 */
const getScope = (req) => {
  if (!req.user?.restaurantId) throw createHttpError(400, "No restaurant scope on user!");
  return {
    restaurantId: req.user.restaurantId,
    outletId: req.user.outletId || null,
  };
};

/**
 * Revoke any existing ACTIVE QR for a table (called before creating a new one)
 * so regeneration invalidates the old token immediately.
 */
const revokeActiveQrForTable = async ({ tableId, restaurantId, outletId, user, reason }) => {
  await TableQR.updateMany(
    {
      tableId,
      restaurantId,
      status: "ACTIVE",
      isDeleted: { $ne: true },
    },
    {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedBy: user?._id || null,
      revokedReason: reason || "Regenerated",
    }
  );
};

/**
 * Get or create a QR for a single table.
 * - If an ACTIVE QR exists, return it (no new token created).
 * - Otherwise create a fresh secure QR.
 */
const getOrCreateQr = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tableId)) throw createHttpError(404, "Invalid table id!");

    const { restaurantId, outletId } = getScope(req);
    const scopeQ = outletId ? { restaurantId, outletId } : { restaurantId };
    const table = await Table.findOne({ _id: tableId, ...scopeQ, isDeleted: { $ne: true } });
    if (!table) throw createHttpError(404, "Table not found!");

    let qr = await TableQR.findOne({ tableId, restaurantId, status: "ACTIVE", isDeleted: { $ne: true } });
    if (!qr) {
      const token = generateSecureToken();
      qr = await TableQR.create({
        token,
        restaurantId,
        outletId: table.outletId || outletId,
        tableId: table._id,
        status: "ACTIVE",
        qrUrl: buildQrUrl(token),
        label: `Table ${table.tableNumber}`,
        createdBy: req.user?._id,
      });
      // Backfill legacy fields so the existing QR flow also works
      await Table.updateOne({ _id: table._id }, { qrToken: token, qrCode: buildQrUrl(token) });
    } else {
      // Heal the stored copies when the host has moved under them.
      //
      // `qrUrl` and `Table.qrCode` are written once, at mint time, and the
      // host in them is deployment config that changes afterwards. Responses
      // are rebuilt from the token so they are always right, but anything
      // reading the stored string directly -- an export, a report, a screen
      // that has not been looked at in a while -- keeps serving the hostname
      // the QR was minted under. Rewrite it the first time the table is
      // opened rather than leaving a wrong URL in the database for good.
      const fresh = buildQrUrl(qr.token);
      if (fresh && qr.qrUrl !== fresh) {
        qr.qrUrl = fresh;
        await qr.save();
      }
      if (fresh && table.qrCode !== fresh) {
        await Table.updateOne({ _id: table._id }, { qrToken: qr.token, qrCode: fresh });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        ...withQrUrl(qr),
        table: { _id: table._id, tableNumber: table.tableNumber, capacity: table.capacity },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Regenerate a QR for a table — revoke old ACTIVE QR, mint a new one.
 * The old token becomes invalid immediately (REVOKED).
 */
const regenerateQr = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tableId)) throw createHttpError(404, "Invalid table id!");

    const { restaurantId, outletId } = getScope(req);
    const scopeQ = outletId ? { restaurantId, outletId } : { restaurantId };
    const table = await Table.findOne({ _id: tableId, ...scopeQ, isDeleted: { $ne: true } });
    if (!table) throw createHttpError(404, "Table not found!");

    // Invalidate any existing ACTIVE QR first
    await revokeActiveQrForTable({
      tableId: table._id,
      restaurantId,
      outletId: table.outletId || outletId,
      user: req.user,
      reason: "Regenerated by admin",
    });

    const token = generateSecureToken();
    const qr = await TableQR.create({
      token,
      restaurantId,
      outletId: table.outletId || outletId,
      tableId: table._id,
      status: "ACTIVE",
      qrUrl: buildQrUrl(token),
      label: `Table ${table.tableNumber}`,
      createdBy: req.user?._id,
    });

    // Backfill legacy fields so the existing QR flow also works
    await Table.updateOne({ _id: table._id }, { qrToken: token, qrCode: buildQrUrl(token) });

    res.status(201).json({
      success: true,
      message: "QR regenerated! The previous QR is now invalid.",
      data: {
        ...withQrUrl(qr),
        table: { _id: table._id, tableNumber: table.tableNumber, capacity: table.capacity },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List QR entries for the restaurant/outlet, optionally filtered by tableId.
 */
const listQrs = async (req, res, next) => {
  try {
    const { restaurantId, outletId } = getScope(req);
    const { tableId, status } = req.query;
    const scopeQ = outletId ? { restaurantId, outletId } : { restaurantId };
    const query = { ...scopeQ, isDeleted: { $ne: true } };
    if (tableId) query.tableId = tableId;
    if (status) query.status = status;

    const qrs = await TableQR.find(query)
      .populate("tableId", "tableNumber capacity status")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: qrs.map(withQrUrl) });
  } catch (error) {
    next(error);
  }
};

/**
 * Revoke a QR (admin). The token can no longer resolve to its table.
 */
const revokeQr = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid QR id!");

    const { restaurantId, outletId } = getScope(req);
    const scopeQ = outletId ? { restaurantId, outletId } : { restaurantId };
    const qr = await TableQR.findOne({ _id: id, ...scopeQ, isDeleted: { $ne: true } });
    if (!qr) throw createHttpError(404, "QR not found!");
    if (qr.status === "REVOKED") {
      return res.status(400).json({ success: false, message: "QR is already revoked." });
    }

    qr.status = "REVOKED";
    qr.revokedAt = new Date();
    qr.revokedBy = req.user?._id;
    qr.revokedReason = req.body?.reason || "Revoked by admin";
    await qr.save();

    // If this was the active QR for the table, clear the legacy token so it stops working
    await Table.updateOne({ _id: qr.tableId, qrToken: qr.token }, { $unset: { qrToken: "", qrCode: "" } });

    res.status(200).json({ success: true, message: "QR revoked!", data: qr });
  } catch (error) {
    next(error);
  }
};

/**
 * PUBLIC: resolve a secure QR token to its table.
 * NEVER trusts client-supplied restaurantId/outletId/tableId.
 * A Table 4 QR can never resolve to Table 5 because the token
 * maps 1:1 to the tableId stored at creation time.
 */
const resolveQrToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) throw createHttpError(400, "QR token is required!");
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) {
      throw createHttpError(404, "Invalid QR code.");
    }

    const qr = await TableQR.findOne({ token, status: "ACTIVE", isDeleted: { $ne: true } });
    if (!qr) throw createHttpError(404, "Invalid QR code.");

    const table = await Table.findOne({ _id: qr.tableId, isDeleted: { $ne: true } });
    if (!table) throw createHttpError(404, "Table not found!");

    res.status(200).json({
      success: true,
      data: {
        token: qr.token,
        status: qr.status,
        label: qr.label,
        qrUrl: buildQrUrl(qr.token),
        table: {
          _id: table._id,
          tableNumber: table.tableNumber,
          capacity: table.capacity,
          restaurantId: table.restaurantId,
          outletId: table.outletId,
        },
        restaurantId: qr.restaurantId,
        outletId: qr.outletId,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a QR as downloaded / printed for admin analytics.
 */
const markUsage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body;
    if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid QR id!");
    if (!["download", "print"].includes(action)) throw createHttpError(400, "action must be 'download' or 'print'!");

    const { restaurantId, outletId } = getScope(req);
    const scopeQ = outletId ? { restaurantId, outletId } : { restaurantId };
    const qr = await TableQR.findOne({ _id: id, ...scopeQ, isDeleted: { $ne: true } });
    if (!qr) throw createHttpError(404, "QR not found!");

    if (action === "download") qr.lastDownloadedAt = new Date();
    if (action === "print") qr.lastPrintedAt = new Date();
    await qr.save();

    res.status(200).json({ success: true, data: qr });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOrCreateQr,
  regenerateQr,
  listQrs,
  revokeQr,
  resolveQrToken,
  markUsage,
  generateSecureToken,
};