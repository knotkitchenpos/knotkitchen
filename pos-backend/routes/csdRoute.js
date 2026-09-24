const express = require("express");
const router = express.Router();

const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { requireCsdAuth, requireCsdAdmin } = require("../middlewares/csdAuth");
const { login, me, logout } = require("../controllers/csdAuthController");
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
  getBillingConfig,
  updateBillingConfig,
  getAccountStanding,
  endTabletRental,
} = require("../controllers/csdBillingConfigController");
const {
  listAgreements, getAgreement, createStoreFromAgreement, retryPortalNotify,
} = require("../controllers/csdAgreementController");
const {
  listDocuments, downloadDocument, uploadDocument, deleteDocument,
} = require("../controllers/csdDocumentController");
const { listMenus, listUsers, updateUser } = require("../controllers/csdCatalogController");
const {
  listHardwareRequests, hardwareRequestCounts, getHardwareRequest, moveHardwareRequest,
  noteHardwareRequest, cancelHardwareRequest,
} = require("../controllers/csdHardwareRequestController");
const {
  getRestaurant, getCustomers, exportCustomers, getOrderSummary, getRestaurantStaff, getActivity,
  updateGoogleBusiness, updateCharges, createPosSession,
} = require("../controllers/csdRestaurantController");

/**
 * KnotKitchen Business — CSD + Admin panel API (csd.knotkitchen.com).
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
// Tight limit on the credential-based login endpoint. otpService's
// per-number cooldown no longer applies (there is no more OTP), so this is
// the only brute-force gate for the panel — per-IP AND per-email so one bad
// IP cannot deny service across every operator.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => 'csd-login:'+clientIp(req)+':'+String(req.body?.email||'').toLowerCase().slice(0,64),
});

router.post('/auth/login', loginLimiter, login);

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
// Bulk export of customer details: admin only, and audit-logged in the controller.
router.get("/restaurants/:storeId/customers/export", requireCsdAdmin, exportCustomers);
router.get("/restaurants/:storeId/order-summary", getOrderSummary);
router.get("/restaurants/:storeId/staff", getRestaurantStaff);
// Activity is a full audit trail (support sessions, jobs, admin actions).
// Staff members should not see who accessed a POS or what other admins did,
// so this is admin-only. The client hides the card too but the server is
// the real guard.
router.get("/restaurants/:storeId/activity", requireCsdAdmin, getActivity);

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

// Menus (read-only, for the website editor's dish picker) and the
// restaurant's own POS users, ported from the Admin Portal. Any signed-in
// staff member may look; only an admin may change a user, which matches the
// Admin Portal's own superAdmin gate on exactly these writes.
router.get("/restaurants/:storeId/menus", requireCsdAuth, listMenus);

// The restaurant's own employees, NOT CSD staff (see /staff above).
// Website design & ordering settings (moved out of the POS's Manage Website).
const { getCsdWebsite, updateCsdWebsite, listCsdWebsiteMedia } = require("../controllers/csdWebsiteController");
router.get("/restaurants/:storeId/website", requireCsdAuth, getCsdWebsite);
router.patch("/restaurants/:storeId/website", requireCsdAdmin, updateCsdWebsite);
router.get("/restaurants/:storeId/website/media", requireCsdAuth, listCsdWebsiteMedia);

router.get("/restaurants/:storeId/users", requireCsdAuth, listUsers);
router.patch("/restaurants/:storeId/users/:userId", requireCsdAdmin, updateUser);

router.get("/reports", requireCsdAdmin, getReports);
router.get("/reports/audit", requireCsdAdmin, getAuditLog);
router.get("/settings", requireCsdAdmin, getSettings);


/**
 * KnotKitchen's own pricing. The ONLY place the POS plan, add-ons, tablets,
 * printers, GST and the per-order charge can be set -- no restaurant-facing
 * route writes any of it. Reading is open to any CSD staff; changing a price,
 * or ending a tablet rental (the physical return), is admin-only.
 */
router.get("/billing/config", getBillingConfig);
router.patch("/billing/config", requireCsdAdmin, updateBillingConfig);
router.get("/billing/accounts/:restaurantId", getAccountStanding);
router.post("/billing/accounts/:restaurantId/tablets/:serial/end", requireCsdAdmin, endTabletRental);

/**
 * Printer and tablet requests from POS Billing (paid by the store). Any CSD
 * staff works the queue; cancelling refunds the store's wallet, so it is
 * admin-only.
 */
router.get("/hardware-requests/counts", hardwareRequestCounts);
router.get("/hardware-requests", listHardwareRequests);
router.get("/hardware-requests/:id", getHardwareRequest);
router.post("/hardware-requests/:id/accept", moveHardwareRequest("accept"));
router.post("/hardware-requests/:id/dispatch", moveHardwareRequest("dispatch"));
router.post("/hardware-requests/:id/deliver", moveHardwareRequest("deliver"));
router.post("/hardware-requests/:id/notes", noteHardwareRequest);
router.post("/hardware-requests/:id/cancel", requireCsdAdmin, cancelHardwareRequest);

module.exports = router;
