const mongoose = require("mongoose");

/**
 * Partners dashboard (knotkitchen.com/partners): one owner, many stores.
 *
 * A PartnerAccount is created the first time a store's Owner signs in there.
 * Every store linked to it is a PartnerLink, made only with that store's own
 * Store ID + phone + password (the Owner login). A store belongs to at most
 * one account (unique storeId), so nobody else can link it.
 *
 * `fingerprint` is a hash of the store owner's password hash when the link
 * was made or last confirmed: a password changed in the POS (or reset by
 * support) makes the link ask for the new password before it is used again.
 */

const partnerSessionSchema = new mongoose.Schema(
  {
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    lastActiveAt: { type: Date, default: Date.now },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    revokedAt: { type: Date, default: null },
  },
  { _id: true }
);

const partnerAccountSchema = new mongoose.Schema(
  {
    // Shown in the dashboard header; the first store owner's name.
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sessions: { type: [partnerSessionSchema], default: [] },
    // Phone alerts: which ones, and their amounts (services/partnerAlerts prefsOf).
    alerts: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

const partnerLinkSchema = new mongoose.Schema(
  {
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "PartnerAccount", required: true, index: true },
    storeId: { type: String, required: true, unique: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    // The store's Owner login the link was made with.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    fingerprint: { type: String, required: true },
    linkedAt: { type: Date, default: Date.now },
    linkedFromIp: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = {
  PartnerAccount: mongoose.model("PartnerAccount", partnerAccountSchema),
  PartnerLink: mongoose.model("PartnerLink", partnerLinkSchema),
};
