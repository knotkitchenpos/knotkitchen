const express = require("express");
const bcrypt = require("bcrypt");
const config = require("../config");
const { AdminUser } = require("../models");
const { wrap, rateLimit, HttpError } = require("../lib/http");
const { issueSession, clearSession, requireAdmin } = require("../lib/adminAuth");
const { permissionsFor, ROLES } = require("../lib/rbac");
const { encrypt, decrypt, verifyTotp, newTotpSecret } = require("../lib/crypto");
const { audit } = require("../lib/audit");

const router = express.Router();
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: "login" });

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function publicAdmin(a) {
  return {
    id: a._id,
    email: a.email,
    name: a.name,
    role: a.role,
    roleName: ROLES[a.role]?.name,
    storeIds: a.storeIds,
    totpEnabled: a.totpEnabled,
    permissions: permissionsFor(a.role),
  };
}

/** Strong-password rule shared by create, reset and change. */
function checkPassword(pw) {
  if (typeof pw !== "string" || pw.length < 12) return "Password must be at least 12 characters";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return "Password needs upper case, lower case and a digit";
  return null;
}

async function checkCredentials(admin, password, totpCode) {
  if (!admin || admin.disabled) return "invalid_credentials";
  if (admin.lockedUntil && admin.lockedUntil > new Date()) return "locked";
  const ok = await bcrypt.compare(String(password || ""), admin.passwordHash);
  if (!ok) return "invalid_credentials";
  if (admin.totpEnabled) {
    if (!totpCode) return "totp_required";
    if (!verifyTotp(decrypt(admin.totpSecretEnc), totpCode)) return "invalid_totp";
  }
  return null;
}

router.post("/login", loginLimit, wrap(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const admin = await AdminUser.findOne({ email });
  const problem = await checkCredentials(admin, req.body.password, req.body.totp);
  if (problem) {
    if (admin && ["invalid_credentials", "invalid_totp"].includes(problem)) {
      admin.failedLogins += 1;
      if (admin.failedLogins >= MAX_FAILED) {
        admin.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        admin.failedLogins = 0;
      }
      await admin.save();
    }
    if (problem !== "totp_required") {
      await audit(req, "auth.login_failed", { targetType: "admin", targetId: admin?._id, details: { email, reason: problem } });
    }
    return res.status(401).json({ error: problem });
  }
  admin.failedLogins = 0;
  admin.lockedUntil = undefined;
  admin.lastLoginAt = new Date();
  admin.lastLoginIp = req.ip;
  await admin.save();
  issueSession(res, admin);
  req.admin = admin;
  await audit(req, "auth.login", { targetType: "admin", targetId: admin._id });
  res.json({ admin: publicAdmin(admin), mustEnable2fa: !admin.totpEnabled && config.isProduction });
}));

router.post("/logout", requireAdmin(), wrap(async (req, res) => {
  await audit(req, "auth.logout", { targetType: "admin", targetId: req.admin._id });
  clearSession(res);
  res.json({ ok: true });
}));

router.get("/me", requireAdmin(), (req, res) => {
  res.json({ admin: publicAdmin(req.admin), reauthValidUntil: (req.authAt || 0) + config.reauthWindowMinutes * 60000 });
});

/** Re-confirms identity before a destructive action. */
router.post("/reauth", loginLimit, requireAdmin(), wrap(async (req, res) => {
  const problem = await checkCredentials(req.admin, req.body.password, req.body.totp);
  if (problem) {
    await audit(req, "auth.reauth_failed", { targetType: "admin", targetId: req.admin._id, details: { reason: problem } });
    return res.status(401).json({ error: problem });
  }
  issueSession(res, req.admin, { authAt: Date.now() });
  await audit(req, "auth.reauth", { targetType: "admin", targetId: req.admin._id });
  res.json({ ok: true, validForMinutes: config.reauthWindowMinutes });
}));

router.post("/2fa/setup", requireAdmin(), wrap(async (req, res) => {
  if (req.admin.totpEnabled) throw new HttpError(409, "already_enabled");
  const secret = newTotpSecret();
  req.admin.totpSecretEnc = encrypt(secret);
  await req.admin.save();
  const label = encodeURIComponent(`KKMDM:${req.admin.email}`);
  res.json({ secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=KKMDM&digits=6&period=30` });
}));

router.post("/2fa/enable", requireAdmin(), wrap(async (req, res) => {
  if (!req.admin.totpSecretEnc) throw new HttpError(400, "setup_first");
  if (!verifyTotp(decrypt(req.admin.totpSecretEnc), req.body.totp)) throw new HttpError(400, "invalid_totp");
  req.admin.totpEnabled = true;
  await req.admin.save();
  await audit(req, "auth.2fa_enabled", { targetType: "admin", targetId: req.admin._id });
  res.json({ ok: true });
}));

router.post("/password", requireAdmin(), wrap(async (req, res) => {
  const problem = await checkCredentials(req.admin, req.body.currentPassword, req.body.totp);
  if (problem) throw new HttpError(401, problem);
  const weak = checkPassword(req.body.newPassword);
  if (weak) throw new HttpError(400, "weak_password", weak);
  req.admin.passwordHash = await bcrypt.hash(req.body.newPassword, 12);
  req.admin.sessionVersion += 1;
  await req.admin.save();
  issueSession(res, req.admin);
  await audit(req, "auth.password_changed", { targetType: "admin", targetId: req.admin._id });
  res.json({ ok: true });
}));

module.exports = { router, publicAdmin, checkPassword };
