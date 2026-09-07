const { BusinessBalance } = require("../models/businessBalanceModel");

/**
 * Gate the POS for a restaurant that has not paid.
 *
 * The allow-list below is the safety-critical part of this file. The spec is
 * explicit that a locked restaurant must still be able to sign in, open
 * Billing, see what it owes and pay it -- a lock that stops someone paying
 * cannot be undone by paying, which is the one outcome nobody wants.
 *
 * So: default-deny for staff APIs, with a short, deliberate list of what stays
 * open. Anything not on the list is refused with a machine-readable code the
 * POS can act on by sending the operator to Billing.
 *
 * Customer-facing traffic is NOT gated. Blocking the storefront or QR ordering
 * punishes the restaurant's DINERS -- someone mid-meal could not settle their
 * table bill -- for a dispute between KnotKitchen and the restaurant. It is
 * available as a wider `lockScope` if the business decides it wants that
 * leverage, but it is never the default.
 *
 * One indexed read per request, and only for signed-in staff. Lock state is
 * decided elsewhere (services/accountLock.js) on the events that change it;
 * this only reads the answer.
 */

/** Paths that stay open to a locked restaurant. Prefix match on req.path. */
const ALWAYS_OPEN = [
  // Signing in and staying signed in. Locking someone out of auth would mean
  // they could not reach Billing at all.
  "/api/auth",
  "/api/user",

  // Paying. The entire point of the lock.
  "/api/business-balance",
  "/api/subscription",
  "/api/billing",

  // The shell the Billing screen needs to render: who am I, what store.
  "/api/restaurant/me",
  "/api/csd",

  // Customers. Never gated by default -- see the note above.
  "/api/public",
  "/api/storefront",
  "/api/qr",
  "/api/table-qr",
  "/api/online-orders",
  "/api/customer",
  "/api/payment",
  "/api/payment-link",

  // Infrastructure and the public receipt page.
  "/health",
  "/ready",
  "/r",
  "/uploads",
];

const isOpen = (path) => ALWAYS_OPEN.some((p) => path === p || path.startsWith(`${p}/`));

/**
 * Applied after authentication, so `req.user` is available. Anonymous requests
 * are not this middleware's business -- they are either public or already
 * refused by the route's own guard.
 */
const enforceAccountLock = async (req, res, next) => {
  try {
    const restaurantId = req.user?.restaurantId;
    if (!restaurantId) return next();
    if (isOpen(req.path)) return next();

    const balance = await BusinessBalance.findOne({ restaurantId })
      .select("lockedAt lockedReason")
      .lean();
    if (!balance?.lockedAt) return next();

    // 402 rather than 403: this is "payment required", it is temporary, and
    // the client should route to Billing rather than treat it as a permissions
    // problem or sign the user out.
    return res.status(402).json({
      success: false,
      code: "ACCOUNT_LOCKED",
      message:
        balance.lockedReason ||
        "This account is locked for non-payment. Settle the outstanding amount in Settings → Billing to continue.",
      lockedAt: balance.lockedAt,
      billingPath: "/settings/billing",
    });
  } catch (err) {
    // A failure to read lock state must not take the POS down. Failing open is
    // the right way round here: the cost is a few minutes of unbilled use, and
    // the alternative is a restaurant unable to trade because of a database
    // hiccup.
    console.warn("[AccountLock] check failed, allowing through:", err && err.message);
    return next();
  }
};

module.exports = { enforceAccountLock, ALWAYS_OPEN, isOpen };
