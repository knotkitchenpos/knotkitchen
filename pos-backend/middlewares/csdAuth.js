const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const CsdStaff = require("../models/csdStaffModel");

const COOKIE_NAME = "csdToken";
const TOKEN_TTL = process.env.CSD_TOKEN_EXPIRY || "12h";

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

const issueSessionCookie = (res, staff) => {
  const token = jwt.sign(
    { sub: String(staff._id), staffId: staff.staffId },
    getSecret(),
    { algorithm: "HS256", expiresIn: TOKEN_TTL }
  );

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    maxAge: 12 * 60 * 60 * 1000,
    path: "/",
  });

  return token;
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
    if (!staff || staff.status !== "active") {
      clearSessionCookie(res);
      return next(createHttpError(401, "Not signed in."));
    }

    req.csdStaff = staff;
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
  clearSessionCookie,
  requireCsdAuth,
  requireCsdAdmin,
};
