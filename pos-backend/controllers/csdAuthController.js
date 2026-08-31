const createHttpError = require("http-errors");
const CsdStaff = require("../models/csdStaffModel");
const config = require("../config/config");
const { issueSessionCookie, clearSessionCookie } = require("../middlewares/csdAuth");
const { csdAudit } = require("../services/csdAuditService");

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
      console.warn(`[SECURITY] RESET_SUPERADMIN_PASSWORD=true — resetting ${email}.`);
      seeded.password = rawPassword;
      dirty = true;
    }
    if (dirty) await seeded.save();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[CSD] Failed to seed super-admin:", err?.message || err);
  }
};

/**
 * POST /api/csd/auth/login  { email, password }
 *
 * A single generic error for every failure — bad email, bad password,
 * disabled account, malformed input — so this endpoint cannot be used to
 * enumerate staff.
 */
const login = async (req, res, next) => {
  try {
    const rawEmail = req.body?.email;
    const rawPassword = req.body?.password;
    if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
      return next(createHttpError(400, "Email and password are required."));
    }
    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword; // do NOT trim — trailing spaces are legal password characters
    if (!email || !password) {
      return next(createHttpError(400, "Email and password are required."));
    }

    // .select("+password") because the schema hides it by default.
    const staff = await CsdStaff.findOne({ email }).select("+password");
    // Same message for "no such user" and "wrong password" — no enumeration.
    if (!staff || staff.status !== "active") {
      return next(createHttpError(401, "Invalid email or password."));
    }

    const ok = await staff.comparePassword(password);
    if (!ok) return next(createHttpError(401, "Invalid email or password."));

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

module.exports = { login, me, logout, seedSuperAdmin };
