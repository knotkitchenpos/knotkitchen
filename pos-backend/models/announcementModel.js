const mongoose = require("mongoose");

/**
 * A message from KnotKitchen to the POS screens (owner, 2026-11-17): a new
 * feature, planned downtime, a price notice. Posted in CSD; every POS that
 * is open shows it as a banner at once (socket "announcement:changed"), and
 * one opened later sees it until it ends. Each device can dismiss it.
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", trim: true, maxlength: 600 },
    level: { type: String, enum: ["info", "warning", "critical"], default: "info" },
    linkUrl: { type: String, default: "", maxlength: 500 },
    linkLabel: { type: String, default: "", maxlength: 40 },
    // Empty = every store; otherwise only these Store IDs.
    storeIds: { type: [String], default: [] },
    startsAt: { type: Date, default: Date.now },
    // null = until someone ends it in CSD.
    endsAt: { type: Date, default: null },
    createdByName: { type: String, default: "" },
    endedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

announcementSchema.index({ startsAt: -1, endsAt: 1 });

module.exports = mongoose.model("Announcement", announcementSchema);
