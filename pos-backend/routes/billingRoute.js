const express = require("express");
const createHttpError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { Subscription, Invoice } = require("../models/billingModel");
const router = express.Router();

/**
 * Legacy billing endpoints.
 *
 * This module is a prototype that was never finished and is not called by any
 * screen: the client wrappers in pos-frontend/src/https/newModules.js exist,
 * but nothing imports them. It is being replaced by the KnotKitchen billing
 * system (services/pricing.js, services/tax.js, services/ledger.js), where
 * prices come from the admin panel rather than from code.
 *
 * Two things were wrong with it beyond being unfinished, and both are fixed
 * here rather than left running until the replacement lands:
 *
 *   TENANCY   `restaurantId` was taken from the request body or the URL and
 *             never checked against the caller, so any signed-in user could
 *             read any restaurant's subscription and fifty of its invoices,
 *             or start a subscription in another restaurant's name. It is now
 *             always the caller's own restaurant; the parameter is ignored.
 *
 *   PRICING   the write paths carried a hard-coded price table in DOLLARS
 *             ({ starter: 29, pro: 99, enterprise: 299 }) and a hard-coded
 *             0.18 tax, and wrote field names the schema does not declare
 *             (`plan`, `billingCycle`, `trialStart` against `planCode`,
 *             `currentPeriodStart`), so Mongoose dropped them silently. They
 *             created records that could not be read back correctly, so they
 *             are gone rather than left to write more of them.
 *
 * What remains is read-only and correctly scoped.
 */

const ownRestaurantId = (req) => {
  const id = req.user?.restaurantId;
  if (!id) throw createHttpError(403, "No restaurant is associated with this account.");
  return id;
};

const gone = (_req, _res, next) =>
  next(
    createHttpError(
      410,
      "This billing endpoint has been withdrawn. Subscriptions are managed from Settings → Billing.",
    ),
  );

// Read the CALLER'S subscription. The :restaurantId in the path is ignored --
// kept only so existing links do not 404 while the replacement is built.
router.get("/:restaurantId", isVerifiedUser, async (req, res, next) => {
  try {
    const restaurantId = ownRestaurantId(req);
    const subscription = await Subscription.findOne({ restaurantId }).sort({ createdAt: -1 });
    const invoices = await Invoice.find({ restaurantId }).sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ success: true, data: { subscription, invoices } });
  } catch (error) {
    next(error);
  }
});

// Everything that wrote money or subscriptions with hard-coded prices.
router.post("/subscribe", isVerifiedUser, gone);
router.post("/:subId/cancel", isVerifiedUser, gone);
router.patch("/:subId/change-plan", isVerifiedUser, gone);
router.post("/invoices/generate", isVerifiedUser, gone);
router.post("/payments", isVerifiedUser, gone);

module.exports = router;
