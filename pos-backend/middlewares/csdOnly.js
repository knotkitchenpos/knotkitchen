const createHttpError = require("http-errors");

/**
 * Refuse a POS-authenticated caller outright.
 *
 * Some capabilities belong to KnotKitchen support (CSD), not to the
 * restaurant: the audit trail is the remaining one. Hiding the tile in the
 * POS Settings list is presentation only -- the endpoint stayed open, so
 * anyone who kept a URL or replayed the request still reached it. This is the
 * actual lock.
 *
 * Storefront configuration was locked here too, and no longer is: Manage
 * Website is the restaurant's own screen again.
 *
 * CSD authenticates on its own routes with its own staff session
 * (`req.csdStaff`), so it never passes through here. Owner and Staff are both
 * refused: this is not a privilege level inside the restaurant, it is a
 * different tenant boundary.
 */
const csdOnly = (feature = "This section") => (req, res, next) => {
  if (req.csdStaff) return next();
  return next(
    createHttpError(
      403,
      `${feature} is managed by KnotKitchen support. Please contact support to make changes.`,
    ),
  );
};

module.exports = { csdOnly };
