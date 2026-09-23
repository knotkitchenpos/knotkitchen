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
 * What every signed-in staff account may do without being granted it: run the
 * floor. See and free tables, show and print a table's QR. Staff accounts are
 * created with only order permissions, so without this a cashier could not
 * release a stranded table and the Security PIN did not help either.
 */
const STAFF_DEFAULT_PERMISSIONS = ["TABLE_READ", "TABLE_UPDATE"];

/** The Security PIN, as a short-lived token or typed in with the request. */
const hasPinAuthorization = async (req) => {
  const pinToken = req.headers["x-staff-pin-token"] || req.cookies?.staffPinToken;
  if (pinToken) {
    try {
      const decoded = jwt.verify(pinToken, config.accessTokenSecret, { algorithms: ["HS256"] });
      if (decoded && decoded.elevated && String(decoded.userId) === String(req.user._id)) return true;
    } catch {
      // Expired or invalid token: fall back to a typed PIN.
    }
  }
  const rawPin = req.headers["x-staff-pin"] || req.body?.pin;
  if (!rawPin) return false;
  const { verifyPinHelper } = require("../controllers/restaurantController");
  const restaurant = await Restaurant.findOne({
    ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
    isDeleted: false,
  });
  return Boolean(restaurant && (await verifyPinHelper(restaurant, rawPin)));
};

/** The POS asks for the PIN and retries when it sees this code (https/axiosWrapper.js). */
const pinRequired = () => createHttpError(403, "PIN authorization required for this action.", { code: "PIN_REQUIRED" });

/**
 * RBAC guard — checks the authenticated user (attached by isVerifiedUser)
 * against the required permission. With `{ pin: true }` the Security PIN
 * also lets a staff member through, as it does for requireProtectedAction.
 */
const requirePermission = (permission, { pin = false } = {}) => async (req, res, next) => {
  try {
    if (!req.user) return next(createHttpError(401, "Authentication required."));

    if (isOwnerUser(req.user)) return next();

    const own = [...(req.user.permissions || []), ...STAFF_DEFAULT_PERMISSIONS];
    if (own.includes("*") || own.includes(permission)) return next();

    if (pin) return next((await hasPinAuthorization(req)) ? undefined : pinRequired());

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
    if (await hasPinAuthorization(req)) return next();
    return next(pinRequired());
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

module.exports = {
  requirePermission,
  requireOwnerOnly,
  requireProtectedAction,
  requireManager,
  isOwnerUser,
  isManagerUser,
  STAFF_DEFAULT_PERMISSIONS,
};
