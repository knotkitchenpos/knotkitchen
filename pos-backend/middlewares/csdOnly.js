const createHttpError = require("http-errors");

/**
 * Refuse a POS-authenticated caller outright.
 *
 * Some capabilities belong to KnotKitchen support (CSD), not to the
 * restaurant: storefront configuration and the audit trail. Hiding the tiles
 * in the POS Settings list is presentation only -- the endpoints stayed open,
 * so anyone who kept a URL or replayed the request still reached them. This
 * is the actual lock.
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
