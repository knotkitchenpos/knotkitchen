const mongoose = require("mongoose");
const CsdStaff = require("../models/csdStaffModel");
const { adminPhones } = require("../middlewares/csdAuth");
const config = require("../config/config");

/**
 * GET /api/csd/settings — admin only.
 *
 * A read-only view of how this deployment is configured, so an administrator
 * can answer "why can/can't X sign in" without shell access.
 *
 * Deliberately reports configuration STATE, never values: it says whether a
 * secret is set and long enough, never the secret itself. Nothing here is
 * editable — these come from deploy/.env and changing them at runtime would
 * mean the running process and the file on disk disagree after any restart.
 */
const getSettings = async (req, res, next) => {
  try {
    const [staffTotal, staffActive, admins] = await Promise.all([
      CsdStaff.countDocuments({}),
      CsdStaff.countDocuments({ status: "active" }),
      CsdStaff.countDocuments({ role: "admin", status: "active" }),
    ]);

    const csdSecret = process.env.CSD_JWT_SECRET || "";
    const dbState = mongoose.connection?.readyState;

    res.status(200).json({
      success: true,
      data: {
        authentication: {
          method: "Phone number + OTP (SMS)",
          smsProvider: "Fast2SMS",
          // Whether OTPs can actually be delivered — the single most common
          // cause of "nobody can log in".
          smsConfigured: Boolean(process.env.FAST2SMS_API_KEY),
          otpValidityMinutes: Math.round((parseInt(process.env.OTP_EXPIRY_MS, 10) || 600000) / 60000),
          otpResendCooldownSeconds: Math.round(
            (parseInt(process.env.OTP_RATE_LIMIT_MS, 10) || 60000) / 1000
          ),
          otpMaxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5,
          sessionLength: process.env.CSD_TOKEN_EXPIRY || "12h",
          sessionSecretConfigured: csdSecret.length >= 32,
          // Never the numbers themselves in full — masked, like OTP logging.
          predefinedAdminPhones: adminPhones().map((p) => `${p.slice(0, 2)}${"*".repeat(6)}${p.slice(-2)}`),
          devOtpBypassEnabled: Boolean(config.allowDevOtp),
        },
        access: {
          model: "Allow-list. A phone number with no active staff record cannot request an OTP.",
          staffTotal,
          staffActive,
          staffDisabled: staffTotal - staffActive,
          activeAdmins: admins,
          roleSource: "Read from the database on every request, never from the session token.",
        },
        platform: {
          environment: config.nodeEnv,
          baseDomain: config.baseDomain || "",
          databaseConnected: dbState === 1,
          timezone: "Asia/Kolkata",
        },
        // Honest statement of what is not built, so an administrator isn't
        // left hunting for a feature that doesn't exist.
        notImplemented: [
          {
            feature: "Chat & job attachments",
            reason:
              "Needs a storage decision (local disk vs S3/Cloudinary) and a document-safe upload path. The existing uploader accepts images only.",
          },
        ],
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSettings };
