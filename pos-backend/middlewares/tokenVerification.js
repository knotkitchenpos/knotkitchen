const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const User = require("../models/userModel");

const isVerifiedUser = async (req, res, next) => {
  try {
    const { accessToken } = req.cookies;

    if (!accessToken) {
      const error = createHttpError(401, "Please provide token!");
      return next(error);
    }

    const decodeToken = jwt.verify(accessToken, config.accessTokenSecret);

    const user = await User.findById(decodeToken._id);
    if (!user) {
      const error = createHttpError(401, "User not exist!");
      return next(error);
    }

    // ---- Tenant isolation ----
    // The token's restaurantId and outletId are immutable and must match
    // the user's current DB values. Prevents IDOR via manipulated JWT claims.
    if (decodeToken.restaurantId?.toString() !== user.restaurantId?.toString()) {
      const error = createHttpError(403, "Forbidden: Tenant mismatch.");
      return next(error);
    }
    if (decodeToken.outletId?.toString() !== user.outletId?.toString()) {
      const error = createHttpError(403, "Forbidden: Outlet mismatch.");
      return next(error);
    }
    if (user.isDeleted || !user.isActive) {
      const error = createHttpError(403, "Account is deactivated.");
      return next(error);
    }

    req.user = user;
    next();
  } catch (error) {
    const err = createHttpError(401, "Invalid Token!");
    next(err);
  }
};

/**
 * Optional guard for QR/customer public endpoints that use a secure
 * table token. Resolves restaurantId/outletId/tableId from the QR
 * entity — never from the client.
 *
 * Security model:
 * - Each active TableQR has a unique token bound 1:1 to a tableId.
 * - A Table 4 QR can NEVER resolve to Table 5: the token maps to the
 *   exact tableId stored at creation time.
 * - REVOKED or regenerated (now REVOKED) tokens fail immediately.
 * - The legacy table.qrToken fallback is removed — QR entity only.
 */
const resolveTableScope = async (req, res, next) => {
  try {
    const { token } = req.params;
    if (!token) {
      const error = createHttpError(400, "QR token is required.");
      return next(error);
    }
    const TableQR = require("../models/tableQRModel");
    const Table = require("../models/tableModel");

    let qr = null;
    if (typeof token === "string" && /^[a-f0-9]{64}$/i.test(token)) {
      qr = await TableQR.findOne({ token, status: "ACTIVE", isDeleted: { $ne: true } });
    }
    if (!qr) {
      const error = createHttpError(404, "Invalid QR code.");
      return next(error);
    }

    const table = await Table.findOne({ _id: qr.tableId, isDeleted: { $ne: true } });
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    req.scope = {
      restaurantId: qr.restaurantId || table.restaurantId,
      outletId: qr.outletId || table.outletId,
      table,
    };
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { isVerifiedUser, resolveTableScope };