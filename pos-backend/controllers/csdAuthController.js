const createHttpError = require("http-errors");
const CsdStaff = require("../models/csdStaffModel");
const { createAndSendOtp, verifyOtp, normalizePhone, maskPhone } = require("../services/otpService");
const { issueSessionCookie, clearSessionCookie, isAdminPhone } = require("../middlewares/csdAuth");
const { csdAudit } = require("../services/csdAuditService");

// otpModel requires a storeId, but a CSD login isn't scoped to any store.
// A constant sentinel keeps those rows in their own namespace so they can
// never collide with a real 6-digit store's OTP for the same phone.
const CSD_OTP_SCOPE = "CSD";
const CSD_OTP_PURPOSE = "csd_login";

const clientIp = (req) =>
  (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .toString()
    .split(",")[0]
    .trim();

/**
 * Look up who, if anyone, is allowed to sign in with this phone.
 *
 * Returns the staff row, or a marker for a predefined admin phone that hasn't
 * been provisioned yet. Anything else is not authorised.
 */
const resolveEligibility = async (phone) => {
  const staff = await CsdStaff.findOne({ phone });

  if (staff) {
    if (staff.status !== "active") return { ok: false };
    return { ok: true, staff };
  }

  // Predefined admin numbers bootstrap themselves on first login, so the
  // system is never locked out with zero administrators.
  if (isAdminPhone(phone)) return { ok: true, staff: null, bootstrapAdmin: true };

  return { ok: false };
};

/**
 * POST /api/csd/auth/send-otp   { phone }
 *
 * Enforces the allow-list: a number with no active staff row (and which isn't
 * a predefined admin) never receives a code.
 */
const sendOtp = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!/^\d{10}$/.test(phone)) {
      return next(createHttpError(400, "Enter a valid 10-digit phone number."));
    }

    const eligibility = await resolveEligibility(phone);
    if (!eligibility.ok) {
      // Deliberately identical to the success shape's failure mode and timing
      // is not constant, but the MESSAGE must not distinguish "not a KnotKitchen
      // number" from "disabled account" — that would let anyone enumerate which
      // numbers belong to staff.
      return next(
        createHttpError(403, "This number is not authorised for the KnotKitchen Business panel.")
      );
    }

    const { expiresAt } = await createAndSendOtp({
      storeId: CSD_OTP_SCOPE,
      phone,
      purpose: CSD_OTP_PURPOSE,
    });

    res.status(200).json({
      success: true,
      data: { maskedPhone: maskPhone(phone), expiresAt },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/auth/verify-otp   { phone, otp }
 *
 * On success issues the httpOnly session cookie and returns the profile,
 * including the role the SPA uses to choose which navigation to render.
 */
const verifyOtpAndSignIn = async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const otp = String(req.body?.otp || "").trim();

    if (!/^\d{10}$/.test(phone) || !/^\d{4,8}$/.test(otp)) {
      return next(createHttpError(400, "Enter the code that was sent to your phone."));
    }

    // Re-check eligibility at verify time too: an admin may have disabled the
    // account in the seconds between the code being sent and used.
    const eligibility = await resolveEligibility(phone);
    if (!eligibility.ok) {
      return next(
        createHttpError(403, "This number is not authorised for the KnotKitchen Business panel.")
      );
    }

    const result = await verifyOtp({
      storeId: CSD_OTP_SCOPE,
      phone,
      otp,
      purpose: CSD_OTP_PURPOSE,
    });
    if (!result.valid) return next(createHttpError(401, result.message || "Invalid OTP."));

    let staff = eligibility.staff;

    if (!staff) {
      // Bootstrap a predefined admin. Retry once on the unique-index collision
      // that a concurrent first login would cause.
      for (let attempt = 0; attempt < 2 && !staff; attempt++) {
        try {
          staff = await CsdStaff.create({
            staffId: await CsdStaff.nextStaffId(),
            fullName: `Administrator ${phone.slice(-4)}`,
            phone,
            role: "admin",
            status: "active",
          });
        } catch (err) {
          if (err?.code !== 11000) throw err;
          staff = await CsdStaff.findOne({ phone });
        }
      }
      if (!staff) return next(createHttpError(500, "Could not provision the administrator account."));
    } else if (isAdminPhone(phone) && staff.role !== "admin") {
      // A predefined admin number always holds admin, even if a row was
      // created for it as staff at some point.
      staff.role = "admin";
    }

    staff.lastLoginAt = new Date();
    staff.loginHistory.push({
      at: staff.lastLoginAt,
      ip: clientIp(req),
      userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    });
    // Keep only the most recent 50 — AuditLog is the permanent record.
    if (staff.loginHistory.length > 50) {
      staff.loginHistory = staff.loginHistory.slice(-50);
    }
    await staff.save();

    issueSessionCookie(res, staff);

    await csdAudit({
      req,
      staff,
      action: "CSD_LOGIN",
      resource: "CsdAuth",
      entityType: "CsdStaff",
      entityId: staff._id,
      description: `${staff.staffId} (${staff.role}) signed in`,
    });

    res.status(200).json({ success: true, data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/auth/me — used by the SPA to restore a session on load. */
const me = async (req, res) => {
  res.status(200).json({ success: true, data: req.csdStaff.toSafeJSON() });
};

/** POST /api/csd/auth/logout */
const logout = async (req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ success: true });
};

module.exports = { sendOtp, verifyOtpAndSignIn, me, logout, CSD_OTP_SCOPE, CSD_OTP_PURPOSE };
