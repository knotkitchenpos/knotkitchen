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
const router = express.Router();

// Store Signup & Verification Endpoints
router.route("/store/validate-id").post(validateStoreId);
router.route("/store/validate-owner").post(validateStoreOwner);
router.route("/store/send-otp").post(sendStoreOtp);
router.route("/store/verify-otp").post(verifyStoreOtp);
router.route("/store/complete-signup").post(completeStoreSignup);

// Auth Spec Standard Endpoints
router.route("/validate-store").post(validateStoreId);
router.route("/request-otp").post(sendStoreOtp);
router.route("/verify-otp").post(verifyStoreOtp);

// Auth
router.route("/register").post(register);
router.route("/login/send-otp").post(sendLoginOtp);
router.route("/login").post(login);
router.route("/refresh").post(refreshToken);
router.route("/logout").post(isVerifiedUser, logout);
router.route("/").get(isVerifiedUser, getUserData);

// Email verification
router.route("/verify-email/request").post(isVerifiedUser, requestEmailVerification);
router.route("/verify-email/:token").get(verifyEmail);

// Password reset
router.route("/forgot-password").post(requestPasswordReset);
router.route("/reset-password").post(resetPassword);

// MFA
router.route("/mfa/setup").post(isVerifiedUser, setupMFA);
router.route("/mfa/verify").post(isVerifiedUser, verifyMFA);
router.route("/mfa/disable").post(isVerifiedUser, disableMFA);

// Sessions
router.route("/sessions").get(isVerifiedUser, getSessions);
router.route("/sessions/:sessionId/revoke").post(isVerifiedUser, revokeSession);

module.exports = router;