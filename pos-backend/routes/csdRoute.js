const express = require("express");
const router = express.Router();

const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { requireCsdAuth, requireCsdAdmin } = require("../middlewares/csdAuth");
const { sendOtp, verifyOtpAndSignIn, me, logout } = require("../controllers/csdAuthController");
const { searchStores, getStore, updateStoreStatus } = require("../controllers/csdStoreController");
const { getDashboard } = require("../controllers/csdDashboardController");
const { createStore, getOptions } = require("../controllers/csdOnboardingController");
const { searchOrders, getOrder } = require("../controllers/csdSearchController");
const {
  listJobs, getJob, createJob, updateJob, changeStatus, addComment, listAssignees,
} = require("../controllers/csdJobController");
const { listStaff, getStaff, createStaff, updateStaff } = require("../controllers/csdStaffController");
const {
  listConversations, createConversation, listMessages, postMessage, searchMessages,
} = require("../controllers/csdChatController");
const { getReports, getAuditLog } = require("../controllers/csdReportsController");
const { getSettings } = require("../controllers/csdSettingsController");
const {
  listAgreements, getAgreement, createStoreFromAgreement, retryPortalNotify,
} = require("../controllers/csdAgreementController");
const {
  listDocuments, downloadDocument, uploadDocument, deleteDocument,
} = require("../controllers/csdDocumentController");
const {
  listMenus, toggleMenuPublish, updateDish,
  listTables, updateTable,
  listUsers, updateUser,
} = require("../controllers/csdCatalogController");
const {
  getRestaurant, getCustomers, getOrderSummary, getRestaurantStaff, getActivity,
  updateGoogleBusiness, updateCharges, createPosSession, listPosSessions,
} = require("../controllers/csdRestaurantController");

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

// Search Console — multi-filter order lookup, core CSD work.
router.get("/orders/search", searchOrders);
router.get("/orders/:id", getOrder);

// Restaurant Details Page (§34: visible to staff AND admin; the mutating
// routes below carry requireCsdAdmin individually).
router.get("/restaurants/:storeId", getRestaurant);
router.get("/restaurants/:storeId/customers", getCustomers);
router.get("/restaurants/:storeId/order-summary", getOrderSummary);
router.get("/restaurants/:storeId/staff", getRestaurantStaff);
router.get("/restaurants/:storeId/activity", getActivity);
router.get("/restaurants/:storeId/pos-sessions", listPosSessions);

// Stored documents (§30/§31). View, upload and update are available to staff
// and admin; DELETE is admin-only and guarded separately below.
router.get("/restaurants/:storeId/documents", listDocuments);
router.get("/restaurants/:storeId/documents/:docId/file", downloadDocument);
router.post("/restaurants/:storeId/documents", uploadDocument);
router.put("/restaurants/:storeId/documents/:docId", uploadDocument);

// POS support access (§22). Available to staff — the spec wants CSD staff to
// fix menus for restaurants — but every issue is audited and the token is
// single-use, short-lived and bound to both this store and this staff member.
router.post("/restaurants/:storeId/pos-session", createPosSession);

// Jobs. Shared by design: the spec wants a record of who did what work for
// which restaurant, which only holds if staff can see and pick up each
// other's jobs. There is deliberately NO delete route — "never permanently
// delete closed jobs from the system".
router.get("/jobs/meta/assignees", listAssignees);
router.get("/jobs", listJobs);
router.post("/jobs", createJob);
router.get("/jobs/:id", getJob);
router.patch("/jobs/:id", updateJob);
router.patch("/jobs/:id/status", changeStatus);
router.post("/jobs/:id/comments", addComment);

// Chat. Threads are readable by every CSD staff member by design — this is an
// internal support desk, and a colleague picking up a ticket needs the history.
router.get("/chat/search", searchMessages);
router.get("/chat/conversations", listConversations);
router.post("/chat/conversations", createConversation);
router.get("/chat/conversations/:id/messages", listMessages);
router.post("/chat/conversations/:id/messages", postMessage);

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

// Staff Management. This is what lets anyone beyond the two predefined admin
// numbers sign in at all — sendOtp refuses phones with no active staff row.
router.get("/staff", requireCsdAdmin, listStaff);
router.post("/staff", requireCsdAdmin, createStaff);
router.get("/staff/:id", requireCsdAdmin, getStaff);
router.patch("/staff/:id", requireCsdAdmin, updateStaff);

// §29/§34: only an admin may change commercial terms or the Google Business
// listing. Staff can see both.
// §31: staff may view, upload and update documents, but never delete one.
router.delete("/restaurants/:storeId/documents/:docId", requireCsdAdmin, deleteDocument);

router.patch("/restaurants/:storeId/charges", requireCsdAdmin, updateCharges);
router.patch("/restaurants/:storeId/google-business", requireCsdAdmin, updateGoogleBusiness);

// Agreement → store creation. Admin only: this creates a paying customer
// record and is the commercial handover from sales to operations.
router.get("/agreements", requireCsdAdmin, listAgreements);
router.get("/agreements/:id", requireCsdAdmin, getAgreement);
router.post("/agreements/:id/create-store", requireCsdAdmin, createStoreFromAgreement);
router.post("/agreements/:id/retry-notify", requireCsdAdmin, retryPortalNotify);

// Menus, Tables and the restaurant's own POS users. These three were the only
// capabilities the Admin Portal had that CSD lacked, and the reason it had to
// keep running. Any signed-in staff member may look; only an admin may change
// anything, which matches the Admin Portal's own superAdmin gate on exactly
// these writes.
router.get("/restaurants/:storeId/menus", requireCsdAuth, listMenus);
router.patch("/restaurants/:storeId/menus/:menuId/publish", requireCsdAdmin, toggleMenuPublish);
router.patch("/restaurants/:storeId/menus/:menuId/items/:itemId", requireCsdAdmin, updateDish);

router.get("/restaurants/:storeId/tables", requireCsdAuth, listTables);
router.patch("/restaurants/:storeId/tables/:tableId", requireCsdAdmin, updateTable);

// The restaurant's own employees, NOT CSD staff (see /staff above).
router.get("/restaurants/:storeId/users", requireCsdAuth, listUsers);
router.patch("/restaurants/:storeId/users/:userId", requireCsdAdmin, updateUser);

router.get("/reports", requireCsdAdmin, getReports);
router.get("/reports/audit", requireCsdAdmin, getAuditLog);
router.get("/settings", requireCsdAdmin, getSettings);

module.exports = router;
