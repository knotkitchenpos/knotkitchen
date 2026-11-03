const createHttpError = require("http-errors");
const CsdStaff = require("../models/csdStaffModel");
const config = require("../config/config");
const { startSession, clearSessionCookie } = require("../middlewares/csdAuth");
const { csdAudit } = require("../services/csdAuditService");
const { normalizePhone } = require("../services/otpService");

const BAD_LOGIN = "Invalid phone number or password.";
const { newSecret, matchStep, otpauthUrl } = require("../services/totp");
const { seal, open } = require("../services/secretBox");

/**
 * CSD authentication — email + password.
 *
 * Migrated 2026-08-30 from phone + OTP because the OTP path had a hard
 * Fast2SMS dependency, and a provider verification block took every operator
 * out of the panel. Email + password mirrors the pattern the (now removed)
 * onboard super-admin used, so no new secret store is needed; the same
 * SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD env vars seed the first admin.
 *
 * Deliberate omissions:
 *   - No self-signup. Staff are provisioned by an existing admin via the
 *     Staff Management screen.
 *   - No password reset endpoint yet. RESET_SUPERADMIN_PASSWORD=true resets
 *     the seeded superadmin on next boot; that is the recovery path until a
 *     proper reset flow ships.
 */

const clientIp = (req) =>
  (req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.ip || "")
    .toString()
    .split(",")[0]
    .trim();

/**
 * Seed the bootstrap superadmin on first run.
 *
 * Loud but non-fatal: a seed failure logs and the server still starts. In
 * production a missing seed just means "sign in with an existing admin
 * account", which is the right behaviour once the platform is off first boot.
 *
 * `RESET_SUPERADMIN_PASSWORD=true` overwrites the seeded admin's password on
 * next start. It only applies to the row created from the seed env vars, so
 * a genuinely disabled admin cannot be re-enabled through an unrelated
 * account with the same email.
 */
const seedSuperAdmin = async () => {
  const email = String(config.csdSeedEmail || "").trim().toLowerCase();
  const rawPassword = String(config.csdSeedPassword || "");
  if (!email || !rawPassword) {
    if (config.isProduction) {
      // eslint-disable-next-line no-console
      console.warn(
        "[CSD] SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD not set — the CSD panel " +
          "will have no seeded administrator until they are provided."
      );
    }
    return;
  }

  try {
    // Look up by seed email OR the isPredefined marker, so a rename via
    // SUPERADMIN_EMAIL still finds the original bootstrap row instead of
    // silently creating a second one.
    let seeded = await CsdStaff.findOne({
      $or: [{ email }, { isPredefined: true }],
    }).select("+password");

    if (!seeded) {
      const staffId = await CsdStaff.nextStaffId();
      const created = new CsdStaff({
        staffId,
        fullName: "Super Admin",
        email,
        password: rawPassword,
        role: "admin",
        isPredefined: true,
        status: "active",
      });
      await created.save();
      // eslint-disable-next-line no-console
      console.log(`✅ Seeded CSD super-admin: ${email}`);
      return;
    }

    let dirty = false;
    if (seeded.email !== email) { seeded.email = email; dirty = true; }
    if (!seeded.isPredefined) { seeded.isPredefined = true; dirty = true; }
    if (seeded.role !== "admin") { seeded.role = "admin"; dirty = true; }
    if (seeded.status !== "active") { seeded.status = "active"; dirty = true; }
    if (process.env.RESET_SUPERADMIN_PASSWORD === "true") {
      // eslint-disable-next-line no-console
      console.warn(`[SECURITY] RESET_SUPERADMIN_PASSWORD=true — resetting ${email} (password, two-factor sign-in and lockout).`);
      seeded.password = rawPassword;
      // The recovery path also clears a lost authenticator: set up again at the next sign-in.
      seeded.mfa = { enabled: false, secret: "", pendingSecret: "", lastStep: 0 };
      seeded.failedLogins = 0;
      seeded.lockedUntil = undefined;
      seeded.tokenVersion = (seeded.tokenVersion || 0) + 1;
      seeded.sessions = [];
      dirty = true;
    }
    if (dirty) await seeded.save();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CSD] Failed to seed super-admin:", err?.message || err);
  }
};

/**
 * POST /api/csd/auth/login  { phone, password }  (or { email, password })
 *
 * Staff sign in with their phone number (owner, 2026-11-03). An email still
 * works, for an account with no phone set yet: whatever contains an "@" is
 * taken as one.
 *
 * A single generic error for every failure — bad phone, bad password,
 * disabled account, malformed input — so this endpoint cannot be used to
 * enumerate staff.
 */
const login = async (req, res, next) => {
  try {
    const rawId = req.body?.phone ?? req.body?.email;
    const rawPassword = req.body?.password;
    if (typeof rawId !== "string" || typeof rawPassword !== "string") {
      return next(createHttpError(400, "Phone number and password are required."));
    }
    const id = rawId.trim();
    const password = rawPassword; // do NOT trim — trailing spaces are legal password characters
    if (!id || !password) {
      return next(createHttpError(400, "Phone number and password are required."));
    }
    const byEmail = id.includes("@");
    const phone = byEmail ? "" : normalizePhone(id);
    if (!byEmail && !/^\d{10}$/.test(phone)) {
      return next(createHttpError(401, BAD_LOGIN));
    }

    // .select("+password") because the schema hides it by default.
    const staff = await CsdStaff.findOne(byEmail ? { email: id.toLowerCase() } : { phone }).select("+password +mfa.secret");
    // Same message for "no such user" and "wrong password" — no enumeration.
    if (!staff || staff.status !== "active") {
      return next(createHttpError(401, BAD_LOGIN));
    }

    // Locked after too many wrong passwords or codes in a row (security audit, 2026-11-03).
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      const mins = Math.ceil((staff.lockedUntil - Date.now()) / 60000);
      return next(createHttpError(429, `Too many failed sign-ins. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`));
    }

    const ok = await staff.comparePassword(password);
    if (!ok) {
      await failedSignIn(staff);
      return next(createHttpError(401, BAD_LOGIN));
    }

    // The second factor: a current code from the authenticator app, each used once.
    if (staff.mfa?.enabled) {
      const code = String(req.body?.code || "").replace(/\s/g, "");
      if (!code) return next(createHttpError(401, "Enter the 6-digit code from your authenticator app.", { code: "MFA_REQUIRED" }));
      const step = matchStep(open(staff.mfa.secret), code);
      if (step === null || step <= (staff.mfa.lastStep || 0)) {
        await failedSignIn(staff);
        return next(createHttpError(401, "That code is not right. Use the current code from your authenticator app.", { code: "MFA_REQUIRED" }));
      }
      staff.mfa.lastStep = step;
    }
    staff.failedLogins = 0;
    staff.lockedUntil = undefined;

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
    // A session of its own for this device, kept until it signs out (saves the row too).
    await startSession(req, res, staff);

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

/**
 * POST /api/csd/auth/logout — this device signs out, on the server too: its
 * session row goes, so its cookie, even a copy, stops working. The account's
 * other devices stay signed in (owner, 2026-11-03).
 */
const logout = async (req, res) => {
  if (req.csdSessionId) await CsdStaff.updateOne({ _id: req.csdStaff._id }, { $pull: { sessions: { sid: req.csdSessionId } } });
  clearSessionCookie(res);
  res.status(200).json({ success: true });
};

/* ------------------------------------------------ two-factor sign-in */

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

/** A wrong password or code: counted, and at MAX_FAILED in a row the account locks for LOCK_MS. */
const failedSignIn = async (staff) => {
  const failed = (staff.failedLogins || 0) + 1;
  const set = failed >= MAX_FAILED
    ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MS) }
    : { failedLogins: failed };
  await CsdStaff.updateOne({ _id: staff._id }, { $set: set });
};

/**
 * POST /api/csd/auth/mfa/setup — a new authenticator secret for this account,
 * kept pending until a code from it is entered (enable). Only while 2FA is not
 * on yet: an admin resets it for a lost phone.
 */
const mfaSetup = async (req, res, next) => {
  try {
    if (req.csdStaff.mfa?.enabled) return next(createHttpError(409, "Two-factor sign-in is already on."));
    const secret = newSecret();
    await CsdStaff.updateOne({ _id: req.csdStaff._id }, { $set: { "mfa.pendingSecret": seal(secret) } });
    res.status(200).json({ success: true, data: { secret, otpauthUrl: otpauthUrl(secret, req.csdStaff.email) } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/auth/mfa/enable { code } — the first code from the app turns 2FA on. */
const mfaEnable = async (req, res, next) => {
  try {
    const staff = await CsdStaff.findById(req.csdStaff._id).select("+mfa.pendingSecret");
    const pending = open(staff?.mfa?.pendingSecret || "");
    if (!pending) return next(createHttpError(400, "Start the setup again."));
    const step = matchStep(pending, req.body?.code);
    if (step === null) return next(createHttpError(400, "That code is not right. Enter the current 6-digit code from the app."));
    staff.mfa = { enabled: true, secret: seal(pending), pendingSecret: "", lastStep: step, enabledAt: new Date() };
    await staff.save();
    await csdAudit({
      req, staff, action: "CSD_MFA_ENABLED", resource: "CsdAuth", entityType: "CsdStaff", entityId: staff._id,
      description: `${staff.staffId} turned on two-factor sign-in`,
    });
    res.status(200).json({ success: true, data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/staff/:id/reset-mfa — an admin clears another account's 2FA
 * (a lost or new phone). It is set up again at that person's next sign-in,
 * and their current sessions end.
 */
const resetStaffMfa = async (req, res, next) => {
  try {
    const mongoose = require("mongoose");
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return next(createHttpError(404, "Staff member not found."));
    const staff = await CsdStaff.findById(req.params.id);
    if (!staff) return next(createHttpError(404, "Staff member not found."));
    staff.mfa = { enabled: false, secret: "", pendingSecret: "", lastStep: 0 };
    staff.failedLogins = 0;
    staff.lockedUntil = undefined;
    staff.tokenVersion = (staff.tokenVersion || 0) + 1;
    staff.sessions = [];
    await staff.save();
    await csdAudit({
      req, staff: req.csdStaff, action: "CSD_MFA_RESET", resource: "CsdStaff", entityType: "CsdStaff", entityId: staff._id,
      description: `${req.csdStaff.staffId} reset two-factor sign-in for ${staff.staffId}`,
    });
    res.status(200).json({ success: true, data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

module.exports = { login, me, logout, seedSuperAdmin, mfaSetup, mfaEnable, resetStaffMfa };
