const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const Admin = require("../models/adminModel");

/**
 * Admin auth middleware.
 *
 * Security notes (§4, §29):
 *   - JWT verified with an explicit HS256 algorithm list (defence against
 *     alg=none / RS-HS confusion).
 *   - Bearer header path retained for the existing frontend, but the cookie
 *     path is the primary channel.
 *   - Generic error message on every failure (§21).
 */
const isAdminVerified = async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.adminToken;
    const bearer = (req.headers?.authorization || "").startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    const token = (typeof cookieToken === "string" && cookieToken) || bearer;

    if (!token) return next(createHttpError(401, "Please provide admin token!"));

    let decoded;
    try {
      decoded = jwt.verify(token, config.adminSecret, { algorithms: ["HS256"] });
    } catch (err) {
      return next(createHttpError(401, "Invalid token!"));
    }

    const admin = await Admin.findById(decoded._id);
    if (!admin || !admin.isActive) return next(createHttpError(401, "Invalid token!"));

    req.admin = admin;
    next();
  } catch (error) {
    next(createHttpError(401, "Invalid token!"));
  }
};

/**
 * Role guard — currently only "superadmin" and "support" roles exist. Use for
 * every destructive / cross-tenant operation (create store, delete store,
 * change user roles, reassign restaurantId, ...). "support" is intentionally
 * read-only.
 */
const requireAdminRole = (...roles) => (req, res, next) => {
  if (!req.admin) return next(createHttpError(401, "Please provide admin token!"));
  if (!roles.includes(req.admin.role)) {
    return next(createHttpError(403, "Forbidden: insufficient permissions."));
  }
  next();
};

module.exports = { isAdminVerified, requireAdminRole };
