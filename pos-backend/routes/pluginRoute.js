const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const PluginConfig = require("../models/pluginModel");
const router = express.Router();

// Get available plugin catalog
router.route("/catalog").get(isVerifiedUser, async (req, res) => {
  const catalog = [
    { name: "swiggy", category: "delivery", provider: "Swiggy" },
    { name: "zomato", category: "delivery", provider: "Zomato" },
    { name: "razorpay", category: "payment", provider: "Razorpay" },
    { name: "stripe", category: "payment", provider: "Stripe" },
    { name: "twilio-sms", category: "sms", provider: "Twilio" },
    { name: "msg91", category: "sms", provider: "MSG91" },
    { name: "sendgrid", category: "email", provider: "SendGrid" },
    { name: "quickbooks", category: "accounting", provider: "QuickBooks" },
    { name: "tally", category: "accounting", provider: "Tally" },
    { name: "zoho-erp", category: "erp", provider: "Zoho" },
    { name: "mailchimp", category: "marketing", provider: "Mailchimp" },
  ];
  res.status(200).json({ success: true, data: catalog });
});

// Connect a plugin
router.route("/connect").post(isVerifiedUser, async (req, res, next) => {
  try {
    const { name, category, provider, restaurantId, config, credentials, webhookUrl } = req.body;
    if (!name || !category || !restaurantId) return res.status(400).json({ success: false, message: "name, category, restaurantId required!" });
    const plugin = await PluginConfig.create({
      name, category, provider, restaurantId, config: config || {}, credentials: credentials || {},
      enabled: true, status: "connected", webhookUrl: webhookUrl || "", createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: plugin });
  } catch (error) { next(error); }
});

// Get plugins for restaurant
router.route("/:restaurantId").get(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await PluginConfig.find({ restaurantId: req.params.restaurantId, isDeleted: false });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Update / toggle plugin
router.route("/:pluginId").patch(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await PluginConfig.findByIdAndUpdate(req.params.pluginId, req.body, { new: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Disconnect plugin
router.route("/:pluginId/disconnect").post(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await PluginConfig.findByIdAndUpdate(req.params.pluginId, { enabled: false, status: "disconnected" }, { new: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Trigger sync for plugin
router.route("/:pluginId/sync").post(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await PluginConfig.findByIdAndUpdate(req.params.pluginId, { syncStatus: "syncing", lastSyncAt: new Date() }, { new: true });
    // In production: enqueue BullMQ job here
    setTimeout(async () => {
      await PluginConfig.findByIdAndUpdate(req.params.pluginId, { syncStatus: "success" });
    }, 2000);
    res.status(200).json({ success: true, data, message: "Sync triggered!" });
  } catch (error) { next(error); }
});

module.exports = router;