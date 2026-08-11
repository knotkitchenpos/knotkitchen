const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    outletId: { type: mongoose.Schema.Types.ObjectId, ref: "Outlet" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["order", "kitchen", "inventory", "loyalty", "billing", "system", "waiter-call", "promotion"],
      default: "system",
    },
    channel: {
      type: String,
      enum: ["email", "sms", "push", "in-app", "whatsapp"],
      default: "in-app",
    },
    priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    isRead: { type: Boolean, default: false },
    readAt: Date,
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ restaurantId: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);