const jwt = require("jsonwebtoken");
const config = require("../config");
const { AdminUser } = require("../models");
const { can } = require("./rbac");

const COOKIE = "kkmdm_session";

function issueSession(res, admin, { authAt = Date.now() } = {}) {
  const token = jwt.sign(
    { sub: String(admin._id), sv: admin.sessionVersion, authAt },
    config.adminJwtSecret,
    { algorithm: "HS256", expiresIn: `${config.adminSessionMinutes}m` },
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    maxAge: config.adminSessionMinutes * 60 * 1000,
    path: "/",
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

/**
 * Signed-in admin, re-checked against the database on every request so a
 * disabled user or a bumped sessionVersion ends sessions at once. The session
 * slides: it is renewed once half its lifetime has passed.
 */
function requireAdmin() {
  return async (req, res, next) => {
    try {
      const token = req.cookies?.[COOKIE];
      if (!token) return res.status(401).json({ error: "not_signed_in" });
      let claims;
      try {
        claims = jwt.verify(token, config.adminJwtSecret, { algorithms: ["HS256"] });
      } catch {
        clearSession(res);
        return res.status(401).json({ error: "session_expired" });
      }
      const admin = await AdminUser.findById(claims.sub);
      if (!admin || admin.disabled || admin.sessionVersion !== claims.sv) {
        clearSession(res);
        return res.status(401).json({ error: "session_revoked" });
      }
      // CSRF: the cookie is SameSite=Strict and state changes need this header,
      // which a cross-site form cannot set.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("X-KKMDM") !== "1") {
        return res.status(403).json({ error: "csrf_header_missing" });
      }
      req.admin = admin;
      req.authAt = claims.authAt;
      const age = Date.now() / 1000 - claims.iat;
      if (age > (config.adminSessionMinutes * 60) / 2) issueSession(res, admin, { authAt: claims.authAt });
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!can(req.admin.role, perm)) return res.status(403).json({ error: "forbidden", permission: perm });
    next();
  };
}

/** Destructive actions need a password (and 2FA) check in the last few minutes. */
function requireRecentAuth(req) {
  return Date.now() - (req.authAt || 0) <= config.reauthWindowMinutes * 60 * 1000;
}

/**
 * Mongo filter limiting what the admin may see. Store users only see their
 * own stores; everyone else their company (super admins see everything).
 * `field` is the store id field of the collection queried.
 */
function scopeFilter(req, { field = "storeId", company = true } = {}) {
  const a = req.admin;
  if (a.role === "store_user") return { [field]: { $in: a.storeIds || [] } };
  if (a.role === "super_admin" || !company || !a.companyId) return {};
  return { companyId: a.companyId };
}

module.exports = { issueSession, clearSession, requireAdmin, requirePerm, requireRecentAuth, scopeFilter, COOKIE };
