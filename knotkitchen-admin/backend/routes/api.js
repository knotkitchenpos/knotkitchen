const express = require("express");
const router = express.Router();

const { login, logout, getMe } = require("../controllers/authController");
const restaurantController = require("../controllers/restaurantController");
const dataController = require("../controllers/dataController");
const { isAdminVerified, requireAdminRole } = require("../middlewares/auth");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");

/**
 * Admin API routes.
 *
 * Access model (§4, §29):
 *   - GET/read endpoints require any authenticated admin (superadmin OR support).
 *   - Any mutating endpoint (create/update/delete/status change) requires
 *     `superadmin`. The pre-fix version did not distinguish, so a "support"
 *     admin — a role which nominally exists in the schema — could delete
 *     stores, reassign users across tenants and elevate roles.
 *
 * Rate limits:
 *   - /admin/login is bucketed per-IP+email, 10 attempts / 15 min.
 *   - /admin/stores/send-otp is bucketed per-IP+phone, 5 sends / 15 min.
 */

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `admin-login:${clientIp(req)}:${String(req.body?.email || "").toLowerCase().slice(0, 128)}`,
  message: "Too many login attempts. Please wait a few minutes and try again.",
});

const storeOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) =>
    `admin-otp:${clientIp(req)}:${String(req.body?.ownerPhone || "").replace(/\D/g, "")}`,
  message: "Too many OTP requests. Please wait before requesting another.",
});

const superAdmin = requireAdminRole("superadmin");

// Auth
router.post("/admin/login", loginLimiter, login);
router.post("/admin/logout", logout);
router.get("/admin/me", isAdminVerified, getMe);

// Global stats (dashboard) — read-only, any admin
router.get("/admin/stats", isAdminVerified, dataController.getGlobalStats);

// Stores (Onboarding) — write path is super-admin only
router.post("/admin/stores/send-otp", isAdminVerified, superAdmin, storeOtpLimiter, restaurantController.sendStoreCreationOtp);
router.post("/admin/stores", isAdminVerified, superAdmin, restaurantController.createStore);
router.get("/admin/stores", isAdminVerified, restaurantController.getAllStores);
router.patch("/admin/stores/:id/status", isAdminVerified, superAdmin, restaurantController.updateStoreStatus);
router.delete("/admin/stores/:id", isAdminVerified, superAdmin, restaurantController.deleteStore);

// Restaurants
router.get("/admin/restaurants", isAdminVerified, restaurantController.getAllRestaurants);
router.get("/admin/restaurants/:id", isAdminVerified, restaurantController.getRestaurantDetail);
router.patch("/admin/restaurants/:id/status", isAdminVerified, superAdmin, restaurantController.toggleRestaurantStatus);
router.put("/admin/restaurants/:id", isAdminVerified, superAdmin, restaurantController.updateRestaurant);

// Users (staff) — mutating a staff user's role/tenant is highly sensitive
router.get("/admin/users", isAdminVerified, dataController.getAllUsers);
router.patch("/admin/users/:id", isAdminVerified, superAdmin, dataController.updateUser);

// Menus
router.get("/admin/menus", isAdminVerified, dataController.getAllMenus);
router.patch("/admin/menus/:menuId/items/:itemId", isAdminVerified, superAdmin, dataController.updateDish);
router.patch("/admin/menus/:id/publish", isAdminVerified, superAdmin, dataController.toggleMenuPublish);

// Orders
router.get("/admin/orders", isAdminVerified, dataController.getAllOrders);
router.patch("/admin/orders/:id", isAdminVerified, superAdmin, dataController.updateOrderStatus);

// Tables
router.get("/admin/tables", isAdminVerified, dataController.getAllTables);
router.patch("/admin/tables/:id", isAdminVerified, superAdmin, dataController.updateTable);

module.exports = router;
