const mongoose = require("mongoose");

/**
 * A KnotKitchen support session into one restaurant's POS (§22).
 *
 * This is the record of CSD staff acting inside a customer's account, so it is
 * deliberately heavier than a plain token:
 *
 *   - The token is stored HASHED. A leaked database dump must not yield usable
 *     session tokens, exactly as with the OTP codes.
 *   - Single use: `usedAt` is set the first time it is exchanged, and the
 *     exchange is a conditional update, so a token replayed from a browser
 *     history or a proxy log is refused.
 *   - Short-lived: minutes, not hours. It only has to survive the redirect.
 *   - Scoped to one storeId AND one CSD staff member, so a token minted for
 *     one restaurant can never open another.
 *   - Rows are NEVER deleted. If a restaurant asks who changed their menu,
 *     this collection answers it. The TTL index only removes the *unused*
 *     ones, which record nothing that happened.
 */
const csdPosSessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true },

    storeId: { type: String, required: true, index: true },
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant" },
    restaurantName: { type: String, default: "" },

    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", required: true, index: true },
    staffCode: { type: String, default: "" },
    staffName: { type: String, default: "" },
    staffRole: { type: String, default: "" },

    reason: { type: String, default: "", maxlength: 500 },

    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    usedFromIp: { type: String, default: "" },

    issuedFromIp: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// Expire only tokens that were never redeemed — a used session is an audit
// record of real access and must survive.
csdPosSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { usedAt: null } }
);
csdPosSessionSchema.index({ storeId: 1, createdAt: -1 });

module.exports = mongoose.model("CsdPosSession", csdPosSessionSchema);
