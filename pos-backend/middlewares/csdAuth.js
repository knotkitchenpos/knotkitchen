const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const CsdStaff = require("../models/csdStaffModel");

const COOKIE_NAME = "csdToken";
// What an account without two-factor sign-in yet may reach: itself, signing out, and setting it up.
const MFA_SETUP_PATHS = ["/api/csd/auth/me", "/api/csd/auth/logout", "/api/csd/auth/mfa/setup", "/api/csd/auth/mfa/enable"];
// A device stays signed in until it signs out (owner, 2026-11-03): the cookie
// is renewed daily while used, and only a device left unopened for the
// browsers' longest cookie life (400 days) is signed out.
const SESSION_DAYS = 400;
const RENEW_AFTER_S = 24 * 3600;
const MAX_DEVICES = 20;

/**
 * Resolve the CSD signing secret LAZILY rather than at module load.
 *
 * config.js's requireSecret() calls process.exit(1) in production when a
 * secret is missing. Wiring CSD_JWT_SECRET in there would mean an existing
 * pos-api deployment refuses to boot the moment this code ships but before
 * the operator adds the variable — taking down the POS API over an unrelated
 * feature. Resolving here instead confines the blast radius: the process
 * starts fine and only /api/csd/* returns 503.
 */
let cachedSecret = null;
const getSecret = () => {
  if (cachedSecret) return cachedSecret;

  const fromEnv = process.env.CSD_JWT_SECRET;
  if (fromEnv && fromEnv.length >= 32) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }

  if (config.isProduction) {
    throw createHttpError(
      503,
      "CSD panel is not configured on this server."
    );
  }

  // Dev only: ephemeral secret, so sessions die on restart but the flow works.
  cachedSecret = crypto.randomBytes(48).toString("hex");
  // eslint-disable-next-line no-console
  console.warn(
    "[SECURITY] CSD_JWT_SECRET not set (or under 32 chars). Using an ephemeral " +
      "secret — CSD sessions will not survive a restart."
  );
  return cachedSecret;
};

/** The session cookie for one device (sid), renewed with the same sid. */
const issueSessionCookie = (res, staff, sid) => {
  const token = jwt.sign(
    // tv: the staff row's tokenVersion; raising it ends every device's session (2FA reset, password).
    // sid: this device's session row; signing out removes it.
    { sub: String(staff._id), staffId: staff.staffId, tv: staff.tokenVersion || 0, sid },
    getSecret(),
    { algorithm: "HS256", expiresIn: `${SESSION_DAYS}d` }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: SESSION_DAYS * 86400 * 1000,
    path: "/",
  });

  return token;
};

/** A newly signed-in device: its own session row (the oldest go past MAX_DEVICES). Saves the staff row. */
const startSession = async (req, res, staff) => {
  const sid = crypto.randomBytes(18).toString("base64url");
  staff.sessions = [...(staff.sessions || []), {
    sid,
    createdAt: new Date(),
    ip: String(req.headers?.["x-real-ip"] || req.ip || "").slice(0, 64),
    userAgent: String(req.headers?.["user-agent"] || "").slice(0, 200),
  }].slice(-MAX_DEVICES);
  await staff.save();
  return issueSessionCookie(res, staff, sid);
};

const clearSessionCookie = (res) =>
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: "/",
  });

/**
 * Authenticate a CSD request.
 *
 * The staff row is re-read from the database on EVERY request and the role is
 * taken from that row, never from the JWT payload. That costs one indexed
 * lookup but means disabling a staff member, or demoting an admin, takes
 * effect immediately instead of at token expiry — with a 12h TTL, trusting a
 * role claim baked into the token would leave a disabled employee with a
 * working admin session for up to half a day.
 */
const requireCsdAuth = async (req, res, next) => {
  try {
    const cookieToken = req.cookies?.[COOKIE_NAME];
    const bearer = (req.headers?.authorization || "").startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : "";
    const token = (typeof cookieToken === "string" && cookieToken) || bearer;

    if (!token) return next(createHttpError(401, "Not signed in."));

    let decoded;
    try {
      decoded = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    } catch {
      // Same generic message for expired/forged/malformed — nothing to learn.
      return next(createHttpError(401, "Not signed in."));
    }

    const staff = await CsdStaff.findById(decoded.sub);
    // Over: a device that signed out (its row is gone), or every device after a 2FA reset or password change (tokenVersion moved on).
    const listed = decoded.sid && (staff?.sessions || []).some((s) => s.sid === decoded.sid);
    if (!staff || staff.status !== "active" || (decoded.tv || 0) !== (staff.tokenVersion || 0) || !listed) {
      clearSessionCookie(res);
      return next(createHttpError(401, "Not signed in."));
    }

    // Two-factor sign-in is required (security audit, 2026-11-03): until it is
    // set up, an account reaches only its own session and the 2FA setup.
    if (!staff.mfa?.enabled && !MFA_SETUP_PATHS.some((p) => req.originalUrl.split("?")[0] === p)) {
      return next(createHttpError(403, "Set up two-factor sign-in to continue.", { code: "MFA_SETUP_REQUIRED" }));
    }

    req.csdStaff = staff;
    req.csdSessionId = decoded.sid;
    // Renewed once a day while used, so a device in use never runs out.
    if (Date.now() / 1000 - decoded.iat > RENEW_AFTER_S) issueSessionCookie(res, staff, decoded.sid);
    next();
  } catch (err) {
    if (err.status === 503) return next(err);
    next(createHttpError(401, "Not signed in."));
  }
};

/**
 * Admin-only guard.
 *
 * MUST be applied on the server to every admin route. The frontend also hides
 * these sections, but that is cosmetic — the spec explicitly requires that a
 * staff member cannot reach admin functionality by editing the URL, and only
 * this check actually enforces that.
 */
const requireCsdAdmin = (req, res, next) => {
  if (!req.csdStaff) return next(createHttpError(401, "Not signed in."));
  if (req.csdStaff.role !== "admin") {
    return next(createHttpError(403, "Administrator access required."));
  }
  next();
};

module.exports = {
  COOKIE_NAME,
  getSecret,
  issueSessionCookie,
  startSession,
  clearSessionCookie,
  requireCsdAuth,
  requireCsdAdmin,
};
