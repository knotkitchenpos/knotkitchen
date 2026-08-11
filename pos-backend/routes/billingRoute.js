const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { Subscription, Invoice, SubscriptionPayment } = require("../models/billingModel");
const router = express.Router();

// Subscribe
router.route("/subscribe").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { plan, restaurantId, billingCycle, trialDays, couponCode } = req.body;
    if (!plan || !restaurantId || !billingCycle) return res.status(400).json({ success: false, message: "Plan, restaurantId, billingCycle required!" });

    const now = new Date();
    const trialEnd = new Date(now.getTime() + (trialDays || 14) * 24 * 60 * 60 * 1000);
    const planPricing = { starter: 29, pro: 99, enterprise: 299 };
    const basePrice = planPricing[plan] || planPricing.starter;
    const cycleMultiplier = billingCycle === "yearly" ? 12 * 0.85 : 1;
    const amount = basePrice * cycleMultiplier;

    const subscription = await Subscription.create({
      plan, restaurantId, billingCycle, trialStart: now, trialEnd,
      status: "trialing", amount, couponCode,
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: subscription });
  } catch (error) { next(error); }
});

// Get subscription
router.route("/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const sub = await Subscription.findOne({ restaurantId: req.params.restaurantId, isDeleted: false }).sort({ createdAt: -1 });
    const invoices = await Invoice.find({ restaurantId: req.params.restaurantId }).sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ success: true, data: { subscription: sub, invoices } });
  } catch (error) { next(error); }
});

// Cancel subscription
router.route("/:subId/cancel").post(isVerifiedUser, async (req, res, next) => {
  try {
    const sub = await Subscription.findByIdAndUpdate(req.params.subId, { status: "cancelled", cancelledAt: new Date() }, { new: true });
    res.status(200).json({ success: true, data: sub });
  } catch (error) { next(error); }
});

// Upgrade / downgrade plan
router.route("/:subId/change-plan").patch(isVerifiedUser, async (req, res, next) => {
  try {
    const { plan } = req.body;
    const sub = await Subscription.findByIdAndUpdate(req.params.subId, { plan }, { new: true });
    res.status(200).json({ success: true, data: sub });
  } catch (error) { next(error); }
});

// Generate invoice
router.route("/invoices/generate").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { subscriptionId, restaurantId, amount, billingPeriodStart, billingPeriodEnd } = req.body;
    if (!subscriptionId || !restaurantId || !amount) return res.status(400).json({ success: false, message: "subscriptionId, restaurantId, amount required!" });
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const invoice = await Invoice.create({
      invoiceNumber, subscriptionId, restaurantId, amount, tax: 0.18 * amount, total: amount * 1.18,
      billingPeriodStart, billingPeriodEnd, status: "pending",
    });
    res.status(201).json({ success: true, data: invoice });
  } catch (error) { next(error); }
});

// Record payment
router.route("/payments").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { invoiceId, amount, method, transactionId } = req.body;
    if (!invoiceId || !amount) return res.status(400).json({ success: false, message: "invoiceId and amount required!" });
    const payment = await SubscriptionPayment.create({ invoiceId, amount, method: method || "card", transactionId: transactionId || `TXN-${Date.now().toString(36).toUpperCase()}`, status: "completed" });
    await Invoice.findByIdAndUpdate(invoiceId, { status: "paid", paymentId: payment._id, paidAt: new Date() });
    res.status(201).json({ success: true, data: payment });
  } catch (error) { next(error); }
});

module.exports = router;