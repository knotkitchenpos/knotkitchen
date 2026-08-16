const express = require("express");
const {
  register, sendLoginOtp, login, refreshToken, getUserData, logout,
  requestEmailVerification, verifyEmail,
  requestPasswordReset, resetPassword,
  setupMFA, verifyMFA, disableMFA,
  getSessions, revokeSession,
  validateStoreId, validateStoreOwner, sendStoreOtp, verifyStoreOtp, completeStoreSignup,
} = require("../controllers/userController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const config = require("../config/config");

const router = express.Router();

/**
 * Rate limiters (§13).
 *
 * The prior implementation shipped NO rate limits on auth endpoints, which
 * left login, OTP request, OTP verify, forgot-password and store lookup
 * open to unbounded brute-force. We now apply:
 *
 *   - per-IP + per-productId login limit (10 / 15 min by default)
 *   - per-IP + per-phone OTP send limit  (5 / 15 min)
 *   - per-IP + per-phone OTP verify limit (10 / 15 min)
 *   - per-IP password reset request limit (5 / 15 min)
 *   - per-IP store-lookup limit          (30 / 5 min)
 *
 * All limits are intentionally generous enough that real POS operators (e.g.
 * on flaky mobile networks, fat-fingering a password once) still work.
 */
const loginLimiter = rateLimit({
  windowMs: config.authLoginRateWindowMs,
  max: config.authLoginRateMax,
  keyGenerator: (req) => `login:${clientIp(req)}:${(req.body?.productId || "").toString().slice(0, 32)}`,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});

const otpSendLimiter = rateLimit({
  windowMs: config.authOtpSendRateWindowMs,
  max: config.authOtpSendRateMax,
  keyGenerator: (req) =>
    `otp-send:${clientIp(req)}:${(req.body?.phone || "").toString().replace(/\D/g, "")}`,
  message: "Too many OTP requests. Please wait a few minutes before requesting another.",
});

const otpVerifyLimiter = rateLimit({
  windowMs: config.authOtpVerifyRateWindowMs,
  max: config.authOtpVerifyRateMax,
  keyGenerator: (req) =>
    `otp-verify:${clientIp(req)}:${(req.body?.phone || "").toString().replace(/\D/g, "")}`,
  message: "Too many verification attempts. Please request a new OTP.",
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

// Store Signup & Verification Endpoints
router.route("/store/validate-id").post(storeLookupLimiter, validateStoreId);
router.route("/store/validate-owner").post(storeLookupLimiter, validateStoreOwner);
router.route("/store/send-otp").post(otpSendLimiter, sendStoreOtp);
router.route("/store/verify-otp").post(otpVerifyLimiter, verifyStoreOtp);
router.route("/store/complete-signup").post(otpVerifyLimiter, completeStoreSignup);

// Auth Spec Standard Endpoints
router.route("/validate-store").post(storeLookupLimiter, validateStoreId);
router.route("/request-otp").post(otpSendLimiter, sendStoreOtp);
router.route("/verify-otp").post(otpVerifyLimiter, verifyStoreOtp);

// Auth
router.route("/register").post(loginLimiter, register);
router.route("/login/send-otp").post(otpSendLimiter, sendLoginOtp);
router.route("/login").post(loginLimiter, login);
router.route("/refresh").post(refreshToken);
router.route("/logout").post(isVerifiedUser, logout);
router.route("/").get(isVerifiedUser, getUserData);

// Email verification
router.route("/verify-email/request").post(isVerifiedUser, requestEmailVerification);
router.route("/verify-email/:token").get(verifyEmail);

// Password reset
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
