const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { Customer, Coupon, GiftCard, WalletTransaction } = require("../models/loyaltyModel");
const router = express.Router();

// Customers
router.route("/customers").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { name, phone, email, restaurantId } = req.body;
    if (!name || !phone || !restaurantId) return res.status(400).json({ success: false, message: "Name, phone, restaurantId required!" });
    const referralCode = `REF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const customer = await Customer.create({ name, phone, email, restaurantId, referralCode });
    res.status(201).json({ success: true, data: customer });
  } catch (error) { next(error); }
});

router.route("/customers/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Customer.find({ restaurantId: req.params.restaurantId, isDeleted: false }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/customers/:customerId").put(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Customer.findByIdAndUpdate(req.params.customerId, req.body, { new: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Reward points & wallet
router.route("/customers/:customerId/points").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { points } = req.body;
    const customer = await Customer.findByIdAndUpdate(req.params.customerId, { $inc: { rewardPoints: points } }, { new: true });
    // Level up logic
    if (customer) {
      if (customer.rewardPoints >= 1000) customer.membershipLevel = "platinum";
      else if (customer.rewardPoints >= 500) customer.membershipLevel = "gold";
      else if (customer.rewardPoints >= 200) customer.membershipLevel = "silver";
      await customer.save();
    }
    res.status(200).json({ success: true, data: customer });
  } catch (error) { next(error); }
});

// Wallet
router.route("/wallet/transactions").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { customerId, type, amount, reason, description, restaurantId } = req.body;
    if (!customerId || !type || !amount || !reason || !restaurantId) return res.status(400).json({ success: false, message: "Missing required fields!" });
    const txn = await WalletTransaction.create({ customerId, type, amount, reason, description, restaurantId });
    const customer = await Customer.findById(customerId);
    if (customer) {
      customer.walletBalance += type === "credit" ? amount : -amount;
      await customer.save();
    }
    res.status(201).json({ success: true, data: txn });
  } catch (error) { next(error); }
});

router.route("/wallet/history/:customerId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await WalletTransaction.find({ customerId: req.params.customerId }).sort({ createdAt: -1 }).limit(100);
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Coupons
router.route("/coupons").post(isVerifiedUser, async (req, res, next) => {
  try {
    const coupon = await Coupon.create({ ...req.body, code: req.body.code.toUpperCase() });
    res.status(201).json({ success: true, data: coupon });
  } catch (error) { next(error); }
});

router.route("/coupons/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Coupon.find({ restaurantId: req.params.restaurantId, isDeleted: false });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

router.route("/coupons/validate/:code").get(isVerifiedUser, async (req, res, next) => {
  try {
    const coupon = await Coupon.findOne({ code: req.params.code.toUpperCase(), isActive: true, isDeleted: false, validFrom: { $lte: new Date() }, validUntil: { $gte: new Date() } });
    if (!coupon) return res.status(404).json({ success: false, message: "Invalid or expired coupon!" });
    res.status(200).json({ success: true, data: coupon });
  } catch (error) { next(error); }
});

// Gift cards
router.route("/gift-cards").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { balance, recipientName, recipientEmail, message, restaurantId } = req.body;
    if (!balance || !restaurantId) return res.status(400).json({ success: false, message: "Balance and restaurantId required!" });
    const code = `GC-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const giftCard = await GiftCard.create({ code, balance, initialBalance: balance, recipientName, recipientEmail, message, restaurantId, createdBy: req.user._id });
    res.status(201).json({ success: true, data: giftCard });
  } catch (error) { next(error); }
});

router.route("/gift-cards/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await GiftCard.find({ restaurantId: req.params.restaurantId });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

module.exports = router;