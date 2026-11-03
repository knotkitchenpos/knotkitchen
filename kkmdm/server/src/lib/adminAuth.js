const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const config = require("../config");
const { AdminUser } = require("../models");
const { can } = require("./rbac");

const COOKIE = "kkmdm_session";
// What an admin without two-factor sign-in may reach in production.
const TWO_FA_SETUP_PATHS = ["/api/auth/me", "/api/auth/logout", "/api/auth/2fa/setup", "/api/auth/2fa/enable", "/api/settings"];

const MAX_DEVICES = 20;

/** The session cookie for one device (sid), renewed with the same sid. */
function issueSession(res, admin, { authAt = Date.now(), sid } = {}) {
  const token = jwt.sign(
    { sub: String(admin._id), sv: admin.sessionVersion, sid, authAt },
    config.adminJwtSecret,
    { algorithm: "HS256", expiresIn: `${config.adminSessionDays}d` },
  );
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: config.isProduction,
    maxAge: config.adminSessionDays * 86400 * 1000,
    path: "/",
  });
}

/** A new signed-in device: its own session row, kept until it signs out (the oldest go past MAX_DEVICES). */
async function startSession(req, res, admin, { authAt = Date.now() } = {}) {
  const sid = crypto.randomBytes(18).toString("base64url");
  admin.sessions = [...(admin.sessions || []), {
    sid, createdAt: new Date(), ip: String(req.ip || "").slice(0, 64), userAgent: String(req.get?.("user-agent") || "").slice(0, 200),
  }].slice(-MAX_DEVICES);
  await admin.save();
  issueSession(res, admin, { authAt, sid });
}

/** This device signs out: its row goes, so its cookie, even a copy, stops working. */
async function endSession(admin, sid) {
  if (!sid) return;
  await AdminUser.updateOne({ _id: admin._id }, { $pull: { sessions: { sid } } });
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
      const listed = claims.sid && (admin?.sessions || []).some((s) => s.sid === claims.sid);
      if (!admin || admin.disabled || admin.sessionVersion !== claims.sv || !listed) {
        clearSession(res);
        return res.status(401).json({ error: "session_revoked" });
      }
      // CSRF: the cookie is SameSite=Strict and state changes need this header,
      // which a cross-site form cannot set.
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("X-KKMDM") !== "1") {
        return res.status(403).json({ error: "csrf_header_missing" });
      }
      // Two-factor sign-in is required in production (security audit,
      // 2026-11-03): KKMDM can install apps on every tablet, so an account
      // without it reaches only itself and the 2FA setup until it is on.
      // An account signed in from CSD had CSD's two-factor sign-in (lib/csdSso.js).
      if (config.isProduction && !admin.totpEnabled && admin.ssoProvider !== "csd" && !TWO_FA_SETUP_PATHS.includes(req.originalUrl.split("?")[0])) {
        return res.status(403).json({ error: "2fa_required" });
      }
      // A CSD account disabled since: KKMDM goes with it; demoted or promoted:
      // its KKMDM role follows (checked every few minutes, lib/csdSso.js).
      if (admin.ssoProvider === "csd") {
        const now = await require("./csdSso").csdStaffNow(String(admin.ssoSubject || "").replace(/^csd:/, ""));
        if (!now.active) {
          await endSession(admin, claims.sid);
          clearSession(res);
          return res.status(401).json({ error: "session_revoked" });
        }
        if (now.role && now.role !== admin.role) {
          admin.role = now.role;
          await AdminUser.updateOne({ _id: admin._id }, { $set: { role: now.role } });
        }
      }
      req.admin = admin;
      req.authAt = claims.authAt;
      req.sessionId = claims.sid;
      // Renewed once a day while used, so a device in use never runs out.
      const age = Date.now() / 1000 - claims.iat;
      if (age > config.adminSessionRenewHours * 3600) issueSession(res, admin, { authAt: claims.authAt, sid: claims.sid });
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

module.exports = { startSession, endSession, issueSession, clearSession, requireAdmin, requirePerm, requireRecentAuth, scopeFilter, COOKIE };
