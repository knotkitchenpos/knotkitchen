const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const User = require("../models/userModel");

/**
 * Access-token guard for all authenticated POS/API routes.
 *
 * Security properties (see also §2 and §16):
 *   - JWT is verified with an explicit HS256 algorithm list, preventing "alg=none"
 *     forgery and RS/HS confusion attacks.
 *   - The token carries a jti (session id). We require that a matching, non-revoked
 *     session still exists on the User document — logout / password reset /
 *     admin revoke therefore invalidates the access token IMMEDIATELY, without
 *     waiting for the 15-minute expiry.
 *   - The token's restaurantId / outletId claims are cross-checked against the
 *     user's current DB values, so a manipulated JWT cannot IDOR into a
 *     different tenant even if a signing key ever leaks.
 *   - Errors are collapsed to a generic 401; internal reason (bad signature,
 *     unknown user, revoked session, tenant mismatch) is never leaked to the
 *     caller (§21).
 */
const isVerifiedUser = async (req, res, next) => {
  try {
    const { accessToken } = req.cookies || {};
    if (!accessToken || typeof accessToken !== "string") {
      return next(createHttpError(401, "Please provide token!"));
    }

    let decodeToken;
    try {
      decodeToken = jwt.verify(accessToken, config.accessTokenSecret, { algorithms: ["HS256"] });
    } catch (err) {
      return next(createHttpError(401, "Invalid Token!"));
    }

    const user = await User.findById(decodeToken._id);
    if (!user) return next(createHttpError(401, "Invalid Token!"));
    if (user.isDeleted || !user.isActive) {
      return next(createHttpError(403, "Account is deactivated."));
    }

    // Tenant claims are pinned to the DB row and cannot be overridden by a
    // tampered token (§3). Empty vs unset counts as equal.
    const claimRestaurant = decodeToken.restaurantId ? String(decodeToken.restaurantId) : "";
    const currentRestaurant = user.restaurantId ? String(user.restaurantId) : "";
    if (claimRestaurant !== currentRestaurant) {
      return next(createHttpError(403, "Forbidden: Tenant mismatch."));
    }
    const claimOutlet = decodeToken.outletId ? String(decodeToken.outletId) : "";
    const currentOutlet = user.outletId ? String(user.outletId) : "";
    if (claimOutlet !== currentOutlet) {
      return next(createHttpError(403, "Forbidden: Outlet mismatch."));
    }

    // Session/jti binding: token is only valid while the session that issued
    // it is still active. Legacy tokens (issued before this fix) have no jti
    // and remain valid until they expire (15 min), which limits blast radius.
    if (decodeToken.jti) {
      const session = (user.sessions || []).find((s) => String(s._id) === String(decodeToken.jti));
      if (!session || session.isRevoked || (session.expiresAt && session.expiresAt < new Date())) {
        return next(createHttpError(401, "Session has ended. Please sign in again."));
      }
    }

    req.user = user;
    req.user.jti = decodeToken.jti || null;
    next();
  } catch (error) {
    next(createHttpError(401, "Invalid Token!"));
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
