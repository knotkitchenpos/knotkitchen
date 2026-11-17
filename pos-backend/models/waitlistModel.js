const mongoose = require("mongoose");

/**
 * A party waiting for a table (owner, 2026-11-17). Added at the host desk,
 * told when a table is ready (WhatsApp "kk_table_ready" once approved), then
 * seated or gone. Every till in the store sees the same list live.
 */
const waitlistSchema = new mongoose.Schema(
  {
    restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, default: "", maxlength: 10 },
    partySize: { type: Number, required: true, min: 1, max: 99 },
    note: { type: String, default: "", trim: true, maxlength: 120 },
    status: { type: String, enum: ["waiting", "notified", "seated", "left"], default: "waiting" },
    notifiedAt: { type: Date, default: null },
    // Whether the WhatsApp actually went out (it may still be pending approval).
    notifiedByWhatsApp: { type: Boolean, default: false },
    doneAt: { type: Date, default: null },
    addedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

waitlistSchema.index({ restaurantId: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model("Waitlist", waitlistSchema);
