const mongoose = require("mongoose");

/**
 * Proactive WhatsApp alerts to store owners (wallet low, device offline,
 * subscription ending). One row per store, kind and day: the unique index is
 * what stops two sweeps, or a sweep and an agent, sending the same alert twice.
 */
const alertSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    kind: { type: String, required: true },
    dayKey: { type: String, required: true }, // YYYY-MM-DD in IST
    status: { type: String, enum: ["sending", "sent", "failed"], default: "sending" },
    error: { type: String, default: "" },
    auto: { type: Boolean, default: false },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "CsdStaff", default: null },
    staffName: { type: String, default: "" },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
alertSchema.index({ storeId: 1, kind: 1, dayKey: 1 }, { unique: true });
alertSchema.index({ storeId: 1, kind: 1, sentAt: -1 });

/** The admin's switch for sending alerts automatically. Off until they turn it on. */
const settingsSchema = new mongoose.Schema(
  {
    _id: { type: String },
    autoEnabled: { type: Boolean, default: false },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

const StoreAlert = mongoose.model("CsdStoreAlert", alertSchema);
const StoreAlertSettings = mongoose.model("CsdStoreAlertSettings", settingsSchema);

module.exports = { StoreAlert, StoreAlertSettings };
