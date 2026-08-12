const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    storeId: { type: String, required: true },
    phone: { type: String, required: true },
    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    verified: { type: Boolean, default: false },
    purpose: { type: String, default: "signup" },
  },
  { timestamps: true }
);

otpSchema.index({ storeId: 1, phone: 1, purpose: 1 });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("OtpVerification", otpSchema);
