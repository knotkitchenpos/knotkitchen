const express = require("express");
const router = express.Router();

const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { requireCsdAuth, requireCsdAdmin } = require("../middlewares/csdAuth");
const { sendOtp, verifyOtpAndSignIn, me, logout } = require("../controllers/csdAuthController");
const { searchStores, getStore, updateStoreStatus } = require("../controllers/csdStoreController");
const { getDashboard } = require("../controllers/csdDashboardController");
const { createStore, getOptions } = require("../controllers/csdOnboardingController");

/**
 * KnotKitchen Business — CSD + Admin panel API (csd.knotkitchen.online).
 *
 * Authorisation is enforced HERE, on the server. The SPA also hides admin
 * navigation from staff, but that is presentation only: the spec requires that
 * a staff member cannot reach admin functionality by typing a URL, and
 * requireCsdAdmin below is what actually guarantees it.
 *
 * Layout of this file mirrors that rule:
 *   1. public   — OTP send/verify only
 *   2. router.use(requireCsdAuth) — everything past this line needs a session
 *   3. shared   — available to staff AND admin
 *   4. admin    — each route additionally carries requireCsdAdmin
 */

// ---------------------------------------------------------------------------
// 1. Public (pre-authentication)
// ---------------------------------------------------------------------------

// Tight limits: this endpoint reveals whether a number is authorised and it
// sends real SMS, so it is both an enumeration and a cost vector. otpService
// separately enforces a 60s per-number cooldown.
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `csd-otp-send:${clientIp(req)}`,
});

const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `csd-otp-verify:${clientIp(req)}`,
});

router.post("/auth/send-otp", otpSendLimiter, sendOtp);
router.post("/auth/verify-otp", otpVerifyLimiter, verifyOtpAndSignIn);

// ---------------------------------------------------------------------------
// 2. Everything below requires a valid, active session
// ---------------------------------------------------------------------------
router.use(requireCsdAuth);

router.get("/auth/me", me);
router.post("/auth/logout", logout);

// ---------------------------------------------------------------------------
// 3. Shared — staff and admin
// ---------------------------------------------------------------------------
router.get("/stores/search", searchStores);
router.get("/stores/:storeId", getStore);

// ---------------------------------------------------------------------------
// 4. Admin only
// ---------------------------------------------------------------------------
// Probe used by the SPA (and by tests) to prove the server-side admin gate is
// live, independently of whether any admin feature is built yet.
router.get("/admin/ping", requireCsdAdmin, (req, res) =>
  res.status(200).json({ success: true, data: { role: req.csdStaff.role } })
);

router.get("/dashboard", requireCsdAdmin, getDashboard);

router.get("/onboarding/options", requireCsdAdmin, getOptions);
router.post("/onboarding/stores", requireCsdAdmin, createStore);

// Status decides whether the public storefront serves customers at all, so it
// is admin-only even though viewing the store is not.
router.patch("/stores/:storeId/status", requireCsdAdmin, updateStoreStatus);

module.exports = router;
