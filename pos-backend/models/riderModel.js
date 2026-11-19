const mongoose = require("mongoose");

/**
 * Delivery riders (KnotKitchen Rider app, knotkitchen.com/rider).
 *
 * A rider belongs to exactly one store. They sign in with their phone and a
 * PIN, so the phone is unique across all stores. Signing up never makes a
 * rider active on its own: the store approves them (Settings > Delivery
 * Riders), or the store invited them first and the rider used that code.
 *
 *   pending      signed up, waiting for the store
 *   active       can sign in, go online and be given deliveries
 *   suspended    can sign in, sees why, gets no deliveries
 *   deactivated  left the store: cannot sign in
 *
 * PINs are bcrypt hashes; the raw PIN is never stored. One-time codes (an
 * invitation, a PIN reset the store issued) are SHA-256 hashes with an expiry.
 */
const STATUSES = ["pending", "active", "suspended", "deactivated"];

const sessionSchema = new mongoose.Schema({
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  lastActiveAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  ip: { type: String, default: "" },
  userAgent: { type: String, default: "" },
});

const riderSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true, match: /^\d{6}$/, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
    pinHash: { type: String, default: "" },
    status: { type: String, enum: STATUSES, default: "pending", index: true },
    online: { type: Boolean, default: false },
    onlineAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },

    // Who let them in, and when.
    approvedAt: { type: Date, default: null },
    approvedBy: { type: String, default: "" },
    statusNote: { type: String, default: "", maxlength: 200 },

    // An invitation or a PIN reset the store issued: a 6-digit code, hashed.
    codeHash: { type: String, default: "" },
    codePurpose: { type: String, enum: ["", "invite", "reset"], default: "" },
    codeExpiresAt: { type: Date, default: null },

    // Wrong PINs: locked for a while after too many.
    failedPins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    sessions: { type: [sessionSchema], default: [] },
    prefs: {
      sound: { type: Boolean, default: true },
      vibration: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

riderSchema.index({ storeId: 1, status: 1, online: 1 });

/** A phone-alert device of a rider. Removed when the push service says it is gone. */
const riderPushSchema = new mongoose.Schema(
  {
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider", required: true, index: true },
    endpoint: { type: String, required: true, unique: true, maxlength: 2000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    userAgent: { type: String, default: "", maxlength: 300 },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/** order.delivery.status values a rider is still working on (services/riders.js). */
const OPEN_DELIVERY_STATUSES = ["assigned", "accepted", "on_the_way", "arrived"];

module.exports = {
  RIDER_STATUSES: STATUSES,
  OPEN_DELIVERY_STATUSES,
  Rider: mongoose.model("Rider", riderSchema),
  RiderPushSubscription: mongoose.model("RiderPushSubscription", riderPushSchema),
};
