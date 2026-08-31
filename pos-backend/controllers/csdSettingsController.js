const mongoose = require("mongoose");
const CsdStaff = require("../models/csdStaffModel");
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
          method: "Email + password",
          sessionLength: process.env.CSD_TOKEN_EXPIRY || "12h",
          sessionSecretConfigured: csdSecret.length >= 32,
          superAdminSeedConfigured: Boolean(
            (process.env.SUPERADMIN_EMAIL || process.env.ADMIN_EMAIL) &&
              (process.env.SUPERADMIN_PASSWORD || process.env.ADMIN_PASSWORD)
          ),
        },
        access: {
          model: "Email + password. A staff record with status !== 'active' cannot sign in.",
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
