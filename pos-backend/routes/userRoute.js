const express = require("express");
const {
  register, login, refreshToken, getUserData, logout,
  requestEmailVerification, verifyEmail,
  requestPasswordReset, resetPassword,
  setupMFA, verifyMFA, disableMFA,
  getSessions, revokeSession,
  validateStoreId, validateStoreOwner,
  checkStoreStatus, setupStorePassword, storeLoginWithPassword, changePassword,
  impersonateWithSupportToken,
} = require("../controllers/userController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const config = require("../config/config");

const router = express.Router();

/**
 * Rate limiters (§13).
 *
 * Every credential-verifying endpoint is protected. All limits are
 * intentionally generous enough that real POS operators (fat-fingering a
 * password once, retrying on a flaky mobile network) still work.
 *
 * The 2026-08-31 migration off Fast2SMS retired otpSendLimiter and
 * otpVerifyLimiter; the two new POS-auth endpoints have their own limiters:
 *
 *   - storeSetupLimiter — /store/setup-password
 *     Per-storeId AND per-IP. The knowledge-factor is the owner phone, and
 *     without SMS confirmation this is the only rate-limit gate between an
 *     attacker guessing (storeId, phone) pairs and being right. Deliberately
 *     tight — an operator setting up once, or resetting after forgetting,
 *     hits it maybe twice in a session.
 *
 *   - storeLoginLimiter — /store/login
 *     Per-storeId AND per-IP. The User model's own loginAttempts + lockout
 *     is the second layer.
 */
const loginLimiter = rateLimit({
  windowMs: config.authLoginRateWindowMs,
  max: config.authLoginRateMax,
  keyGenerator: (req) =>
    `login:${clientIp(req)}:${(req.body?.productId || "").toString().slice(0, 32)}`,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});

const storeLoginLimiter = rateLimit({
  windowMs: config.authLoginRateWindowMs,
  max: config.authLoginRateMax,
  keyGenerator: (req) =>
    `store-login:${clientIp(req)}:${(req.body?.storeId || "").toString().slice(0, 12)}`,
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});

const storeSetupLimiter = rateLimit({
  // 5 per hour per storeId + IP. Reset-password and first-time-setup both go
  // through here; a legitimate operator hits it maybe twice a year.
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) =>
    `store-setup:${clientIp(req)}:${(req.body?.storeId || "").toString().slice(0, 12)}`,
  message: "Too many attempts. Please wait an hour before trying again.",
});

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `pwreset:${clientIp(req)}`,
  message: "Too many password reset requests. Please wait a few minutes.",
});

const storeLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `store-lookup:${clientIp(req)}`,
  message: "Too many store lookups. Please slow down.",
});

// ---------------------------------------------------------------------------
// POS store auth (password-based, 2026-08-31)
//
// /store/status         — used by the client to decide UI mode
// /store/setup-password — first-time create OR reset (idempotent by intent)
// /store/login          — steady-state sign-in
// ---------------------------------------------------------------------------
router.route("/store/status").post(storeLookupLimiter, checkStoreStatus);
router.route("/store/setup-password").post(storeSetupLimiter, setupStorePassword);
router.route("/store/login").post(storeLoginLimiter, storeLoginWithPassword);

// One-shot support handoff. Consumes a token minted by CSD's
// createPosSession and drops the caller into a normal POS session. No auth
// middleware — the token itself is the credential and is single-use.
router.route("/impersonate").post(impersonateWithSupportToken);

// Legacy lookup endpoints (still used by the current login screen before
// this migration, and by future admin tools).
router.route("/store/validate-id").post(storeLookupLimiter, validateStoreId);
router.route("/store/validate-owner").post(storeLookupLimiter, validateStoreOwner);
router.route("/validate-store").post(storeLookupLimiter, validateStoreId);

// Auth
router.route("/register").post(loginLimiter, register);
router.route("/login").post(loginLimiter, login);
router.route("/refresh").post(refreshToken);
router.route("/logout").post(isVerifiedUser, logout);
router.route("/").get(isVerifiedUser, getUserData);
router.route("/change-password").post(isVerifiedUser, changePassword);

// Email verification
router.route("/verify-email/request").post(isVerifiedUser, requestEmailVerification);
router.route("/verify-email/:token").get(verifyEmail);

// Password reset (email-based; separate from the storeId-based reset above,
// which is what POS operators actually use)
router.route("/forgot-password").post(passwordResetLimiter, requestPasswordReset);
router.route("/reset-password").post(passwordResetLimiter, resetPassword);

// MFA
router.route("/mfa/setup").post(isVerifiedUser, setupMFA);
router.route("/mfa/verify").post(isVerifiedUser, verifyMFA);
router.route("/mfa/disable").post(isVerifiedUser, disableMFA);

// Sessions
router.route("/sessions").get(isVerifiedUser, getSessions);
router.route("/sessions/:sessionId/revoke").post(isVerifiedUser, revokeSession);

module.exports = router;
