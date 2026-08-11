const express = require("express");
const {
  register, login, refreshToken, getUserData, logout,
  requestEmailVerification, verifyEmail,
  requestPasswordReset, resetPassword,
  setupMFA, verifyMFA, disableMFA,
  getSessions, revokeSession,
} = require("../controllers/userController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

// Auth
router.route("/register").post(register);
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