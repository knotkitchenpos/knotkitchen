const createHttpError = require("http-errors");
const jwt = require("jsonwebtoken");
const config = require("../config/config");
const Restaurant = require("../models/restaurantModel");

const isOwnerUser = (user) => {
  if (!user || !user.role) return false;
  const role = String(user.role).toLowerCase();
  return role === "owner" || role === "superadmin";
};

/**
 * RBAC guard — checks the authenticated user (attached by isVerifiedUser)
 * against the required permission.
 */
const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));

    if (isOwnerUser(req.user)) return next();

    const own = req.user.permissions || [];
    if (own.includes("*") || own.includes(permission)) return next();

    return next(createHttpError(403, `Forbidden: requires '${permission}' permission.`));
  } catch (error) {
    next(error);
  }
};

/**
 * Owner-Only Authorization Guard.
 * Restricts access STRICTLY to store owners.
 * Staff members CANNOT bypass this check even if they enter the Security PIN.
 */
const requireOwnerOnly = async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));
    if (isOwnerUser(req.user)) return next();
    return next(createHttpError(403, "Access denied: This action is restricted to the Store Owner only."));
  } catch (error) {
    next(error);
  }
};

/**
 * Protected Action Guard.
 * Owner is allowed automatically.
 * Staff members require valid Security PIN authorization (header x-staff-pin-token, x-staff-pin, or req.body.pin).
 */
const requireProtectedAction = async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));
    if (isOwnerUser(req.user)) return next();

    // Staff member access check: verify PIN token
    const pinToken = req.headers["x-staff-pin-token"] || req.cookies?.staffPinToken;
    if (pinToken) {
      try {
        const decoded = jwt.verify(pinToken, config.accessTokenSecret, { algorithms: ["HS256"] });
        if (decoded && decoded.elevated && String(decoded.userId) === String(req.user._id)) {
          return next();
        }
      } catch (err) {
        // Expired or invalid token, fallback to PIN check
      }
    }

    // Direct PIN header / body fallback
    const rawPin = req.headers["x-staff-pin"] || req.body?.pin;
    if (rawPin) {
      const { verifyPinHelper } = require("../controllers/restaurantController");
      const restaurant = await Restaurant.findOne({
        ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
        isDeleted: false,
      });
      if (restaurant && (await verifyPinHelper(restaurant, rawPin))) {
        return next();
      }
    }

    return next(createHttpError(403, "PIN authorization required for this action."));
  } catch (error) {
    next(error);
  }
};

/**
 * Store management only: the owner, or a user whose role is Admin or
 * Manager. Waiters, cashiers and other staff are refused, PIN or not.
 */
const isManagerUser = (user) => {
  if (isOwnerUser(user)) return true;
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "manager";
};

const requireManager = async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));
    if (isManagerUser(req.user)) return next();
    return next(createHttpError(403, "Only the store owner or a manager can do this."));
  } catch (error) {
    next(error);
  }
};

module.exports = { requirePermission, requireOwnerOnly, requireProtectedAction, requireManager, isOwnerUser, isManagerUser };
