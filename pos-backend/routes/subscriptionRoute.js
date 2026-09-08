const express = require("express");
const createHttpError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { listPlansFor } = require("../services/pricing");
const { quote, purchasePlan, statusFor, SubscriptionError } = require("../services/subscription");
const { PlatformInvoice } = require("../models/platformSubscriptionModel");
const { urlForInvoice } = require("../services/receiptLink");
const { toRupees, formatINR } = require("../services/money");
const { requireProtectedAction } = require("../middlewares/requirePermission");

const router = express.Router();

/**
 * The restaurant's own subscription and invoices.
 *
 * Read-and-buy only. Nothing here can set a price: plans, offers, GST and
 * per-restaurant rates are all admin-owned, and this router never writes to
 * any of them. Every route is scoped to the caller's own restaurant, taken
 * from the session and never from the request.
 */

const ownRestaurantId = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};

const asAmount = (paise) => ({ paise, rupees: toRupees(paise), label: formatINR(paise) });

const asSubscriptionError = (err, next) =>
  err instanceof SubscriptionError
    ? next(createHttpError(err.status, err.message))
    : next(err);

// GET /api/subscription — what plan, until when, and is it in grace.
router.get("/", isVerifiedUser, async (req, res, next) => {
  try {
    const status = await statusFor(ownRestaurantId(req));
    res.status(200).json({
      success: true,
      data: { ...status, lastPaidPrice: asAmount(status.lastPaidPricePaise) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/plans — priced FOR THIS restaurant, offers and
// negotiated rates already applied.
router.get("/plans", isVerifiedUser, async (req, res, next) => {
  try {
    // Locked plans are LISTED, not hidden: a restaurant should see what
    // exists and which tier it could move to. `isAvailable: false` still
    // refuses the purchase itself, in quote().
    const plans = await listPlansFor({
      restaurantId: ownRestaurantId(req),
      includeUnavailable: true,
    });
    res.status(200).json({
      success: true,
      data: plans.map((p) => ({ ...p, price: asAmount(p.pricePaise) })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/subscription/quote/:planCode — what it would cost, without buying.
router.get("/quote/:planCode", isVerifiedUser, async (req, res, next) => {
  try {
    const q = await quote({
      restaurantId: ownRestaurantId(req),
      planCode: String(req.params.planCode),
    });
    res.status(200).json({
      success: true,
      data: { ...q, charge: asAmount(q.chargePaise), total: asAmount(q.totalPaise) },
    });
  } catch (err) {
    asSubscriptionError(err, next);
  }
});

/**
 * POST /api/subscription/purchase — buy, renew or upgrade.
 *
 * Paid from the Business Balance. A shortfall answers 402 with the amounts,
 * so the UI can send them to top up rather than just saying no.
 */
// Changing the plan is an Owner decision. requireProtectedAction lets the
// Owner straight through and makes a Staff member enter the Store Properties
// PIN -- the same gate the other money-touching settings already use.
router.post("/purchase", isVerifiedUser, requireProtectedAction, async (req, res, next) => {
  try {
    const planCode = String(req.body?.planCode || "");
    if (!planCode) throw createHttpError(400, "planCode is required.");

    const result = await purchasePlan({
      restaurantId: ownRestaurantId(req),
      planCode,
      createdBy: req.user?._id,
    });

    res.status(201).json({
      success: true,
      data: {
        planCode: result.subscription.planCode,
        planName: result.subscription.planName,
        currentPeriodEnd: result.subscription.currentPeriodEnd,
        charged: asAmount(result.charged),
        invoice: result.invoice
          ? {
              id: result.invoice._id,
              number: result.invoice.invoiceNumber,
              total: asAmount(result.invoice.totalPaise),
              url: urlForInvoice(result.invoice._id),
            }
          : null,
      },
    });
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
