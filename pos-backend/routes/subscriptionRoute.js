const express = require("express");
const mongoose = require("mongoose");
const createHttpError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  quote,
  billView,
  statusFor,
  addAddon,
  removeAddon,
  renewDue,
  cancelSubscription,
  reinstateSubscription,
  SubscriptionError,
} = require("../services/subscription");
const { PlatformInvoice } = require("../models/platformSubscriptionModel");
const { urlForInvoice } = require("../services/receiptLink");
const { asAmount } = require("../services/money");
const { requireProtectedAction, requireOwnerOnly } = require("../middlewares/requirePermission");
const {
  HardwareRequestError,
  resolveShipTo,
  listForStore,
  cancelRequest,
  storeView,
} = require("../services/hardwareRequests");

const router = express.Router();

/**
 * The restaurant's own POS plan, add-ons, devices (tablets and printers) and invoices.
 *
 * Read-and-buy only. Nothing here can set a price: the catalogue, GST and
 * per-restaurant rates are all admin-owned, and this router never writes to
 * any of them. Every route is scoped to the caller's own restaurant, taken
 * from the session and never from the request.
 *
 * Buying is an Owner decision. requireProtectedAction lets the Owner straight
 * through and makes a Staff member enter the Store Properties PIN -- the same
 * gate the other money-touching settings already use.
 */

const ownRestaurantId = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};

/** Who accepted, from where. Recorded with the purchase. */
const acceptanceFrom = (req) => ({
  accepted: req.body?.accepted === true,
  user: req.user,
  ip: req.ip || "",
  userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
});

const asSubscriptionError = (err, next) =>
  err instanceof SubscriptionError || err instanceof HardwareRequestError
    ? next(createHttpError(err.status, err.message, { code: err.code }))
    : next(err);

/** What a purchase answers: what it cost, and the invoice if one was issued. */
const purchased = (result) => ({
  already: Boolean(result.already),
  charged: asAmount(result.charged),
  invoice: result.invoice
    ? {
        id: result.invoice._id,
        number: result.invoice.invoiceNumber,
        total: asAmount(result.invoice.totalPaise),
        url: urlForInvoice(result.invoice._id),
      }
    : null,
});

// GET /api/subscription — the plan, add-ons, rented tablets, devices, next renewal.
router.get("/", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    // Renew first if the period has ended and the wallet covers it.
    await renewDue(new Date(), { restaurantId });
    res.status(200).json({ success: true, data: await statusFor(restaurantId) });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/quote?item=ADDON:<code>|PRINTER:<code> — what buying it
// charges now (TABLET = PRINTER:TABLET, the tablet device).
router.get("/quote", isVerifiedUser, async (req, res, next) => {
  try {
    const bill = await quote({ restaurantId: ownRestaurantId(req), item: String(req.query.item || "") });
    res.status(200).json({ success: true, data: billView(bill) });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// POST /api/subscription/addons { code, accepted } — add one for the rest of
// this period, or (one with its own period, the yearly Website) for a full period from today.
router.post("/addons", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    const result = await addAddon({
      restaurantId: ownRestaurantId(req),
      code: String(req.body?.code || ""),
      createdBy: req.user?._id,
      acceptance: acceptanceFrom(req),
    });
    res.status(201).json({ success: true, data: purchased(result) });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// DELETE /api/subscription/addons/:code — stop it at the end of the period
// already paid (its own, or the POS's). No refund.
router.delete("/addons/:code", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    const { endsAt } = await removeAddon({ restaurantId: ownRestaurantId(req), code: String(req.params.code) });
    res.status(200).json({ success: true, data: { code: String(req.params.code).toUpperCase(), endsAt } });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// POST /api/subscription/tablets — renting a tablet is retired. A tablet is
// bought once, like a printer: POST /printers { code: "TABLET" }.
router.post("/tablets", isVerifiedUser, (req, res, next) =>
  next(createHttpError(409, "Tablets are now bought once, like printers.", { code: "TABLET_NOW_PURCHASED" })),
);

// POST /api/subscription/printers { code, accepted, shipTo } — buy a device
// (a printer, or the tablet: code "TABLET") outright, delivered by
// KnotKitchen to shipTo (the store's own address when left out). Paid through
// Cashfree, never from the wallet: this opens the payment;
// /api/business-balance/recharge/verify (or the webhook) records it.
router.post("/printers", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    const { createPrinterPayment, ownReturnUrl, RechargeError } = require("../services/recharge");
    try {
      const restaurantId = ownRestaurantId(req);
      const opened = await createPrinterPayment({
        restaurantId,
        code: String(req.body?.code || ""),
        acceptance: acceptanceFrom(req),
        shipTo: await resolveShipTo(restaurantId, req.body?.shipTo),
        createdBy: req.user?._id,
        returnUrl: ownReturnUrl(req.body?.returnUrl),
      });
      res.status(201).json({ success: true, data: opened });
    } catch (err) {
      if (err instanceof RechargeError) return next(createHttpError(err.status, err.message, { expose: true, code: err.code }));
      throw err;
    }
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// GET /api/subscription/hardware-requests — this store's printer and tablet
// requests and where each one is, newest first.
router.get("/hardware-requests", isVerifiedUser, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await listForStore(ownRestaurantId(req)) });
  } catch (err) {
    next(err);
  }
});

// POST /api/subscription/hardware-requests/:id/cancel — only while KnotKitchen
// has not started on it; everything paid goes back to the wallet.
router.post("/hardware-requests/:id/cancel", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new HardwareRequestError("No such request.", 404);
    const request = await cancelRequest({
      id: req.params.id,
      restaurantId: ownRestaurantId(req),
      by: { type: "STORE", id: req.user?._id, name: req.user?.name },
      reason: String(req.body?.reason || ""),
    });
    res.status(200).json({ success: true, data: storeView(request) });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// POST /api/subscription/renew — try the renewal now (after a CSD credit, say):
// the POS plan, and any add-on whose own period has ended.
router.post("/renew", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    const result = await renewDue(new Date(), { restaurantId });
    const status = await statusFor(restaurantId);
    res.status(200).json({
      success: true,
      data: {
        renewed: result.renewed > 0,
        status: status.status,
        currentPeriodEnd: status.currentPeriodEnd,
        lastRenewalError: status.lastRenewalError,
        // Add-ons on their own clock: renewed now, or why not ({ code, message }).
        addonsRenewed: result.addonsRenewed,
        addonErrors: result.addonErrors,
      },
    });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// POST /api/subscription/cancel { reason? } — the Owner cancels the POS
// subscription: renewals stop, it runs to the end of the paid period, then the
// store is closed. Nothing is refunded. Answers with GET /api/subscription.
router.post("/cancel", isVerifiedUser, requireOwnerOnly, requireProtectedAction, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    await cancelSubscription({
      restaurantId,
      reason: String(req.body?.reason || ""),
      by: { type: "RESTAURANT", name: req.user?.name || "" },
    });
    res.status(200).json({ success: true, data: await statusFor(restaurantId) });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// POST /api/subscription/reinstate — the Owner undoes the cancellation before
// it takes effect. Answers with GET /api/subscription.
router.post("/reinstate", isVerifiedUser, requireOwnerOnly, requireProtectedAction, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    await reinstateSubscription({ restaurantId, by: { type: "RESTAURANT", name: req.user?.name || "" } });
    res.status(200).json({ success: true, data: await statusFor(restaurantId) });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

// GET /api/subscription/invoices — this restaurant's invoices, newest first.
router.get("/invoices", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    const rows = await PlatformInvoice.find({ restaurantId })
      .sort({ invoiceDate: -1 })
      .limit(Math.min(200, Number(req.query.limit) || 50))
      .lean();

    res.status(200).json({
      success: true,
      data: rows.map((i) => ({
        id: i._id,
        number: i.invoiceNumber,
        date: i.invoiceDate,
        kind: i.kind,
        status: i.status,
        total: asAmount(i.totalPaise),
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        // A signed link, viewable and printable without a session -- POS
        // cookies are keyed by an x-store-id header a plain link cannot send.
        url: urlForInvoice(i._id),
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
