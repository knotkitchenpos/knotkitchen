const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const Notification = require("../models/notificationModel");
const router = express.Router();

// Get notifications for user (in-app)
router.route("/in-app").get(isVerifiedUser, async (req, res, next) => {
  try {
    const { limit = 50, unreadOnly } = req.query;
    const query = { userId: req.user._id, isDeleted: false };
    if (unreadOnly === "true") query.isRead = false;
    const data = await Notification.find(query).sort({ createdAt: -1 }).limit(parseInt(limit));
    const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false, isDeleted: false });
    res.status(200).json({ success: true, data, unreadCount });
  } catch (error) { next(error); }
});

// Create notification (internal or admin)
router.route("/").post(isVerifiedUser, async (req, res, next) => {
  try {
    const notification = await Notification.create({ ...req.body, userId: req.body.userId || req.user._id });
    res.status(201).json({ success: true, data: notification });
  } catch (error) { next(error); }
});

// Mark as read
router.route("/:id/read").patch(isVerifiedUser, async (req, res, next) => {
  try {
    const data = await Notification.findByIdAndUpdate(req.params.id, { isRead: true, readAt: new Date() }, { new: true });
    res.status(200).json({ success: true, data });
  } catch (error) { next(error); }
});

// Mark all as read
router.route("/read-all").patch(isVerifiedUser, async (req, res, next) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
    res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error) { next(error); }
});

// Delete notification
router.route("/:id").delete(isVerifiedUser, async (req, res, next) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isDeleted: true });
    res.status(200).json({ success: true, message: "Notification deleted" });
  } catch (error) { next(error); }
});

module.exports = router;