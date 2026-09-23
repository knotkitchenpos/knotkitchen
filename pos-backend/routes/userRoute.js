const express = require("express");
const {
  refreshToken, getUserData, logout,
  checkStoreStatus, checkStoreAccountStatus, setStoreAccountPassword,
  setupStorePassword, storeLoginWithPassword, changePassword,
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

// Staff first sign-in. account-status tells the client whether to show a
// password field or Create Password; set-password is one-shot and only works
// while the account still has the placeholder the owner created it with.
// Both carry the same per-storeId + IP limits as the other lookups.
router.route("/store/account-status").post(storeLookupLimiter, checkStoreAccountStatus);
router.route("/store/set-password").post(storeSetupLimiter, setStoreAccountPassword);
router.route("/store/login").post(storeLoginLimiter, storeLoginWithPassword);

// One-shot support handoff. Consumes a token minted by CSD's
// createPosSession and drops the caller into a normal POS session. No auth
// middleware — the token itself is the credential and is single-use.
router.route("/impersonate").post(impersonateWithSupportToken);

// Auth
router.route("/refresh").post(refreshToken);
router.route("/logout").post(isVerifiedUser, logout);
router.route("/").get(isVerifiedUser, getUserData);
router.route("/change-password").post(isVerifiedUser, changePassword);

module.exports = router;
