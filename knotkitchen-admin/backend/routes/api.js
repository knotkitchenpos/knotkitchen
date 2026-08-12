const express = require("express");
const router = express.Router();

const { login, logout, getMe } = require("../controllers/authController");
const restaurantController = require("../controllers/restaurantController");
const dataController = require("../controllers/dataController");
const { isAdminVerified } = require("../middlewares/auth");

// Auth
router.post("/admin/login", login);
router.post("/admin/logout", logout);
router.get("/admin/me", isAdminVerified, getMe);

// Global stats (dashboard)
router.get("/admin/stats", isAdminVerified, dataController.getGlobalStats);

// Stores (Onboarding)
router.post("/admin/stores", isAdminVerified, restaurantController.createStore);
router.get("/admin/stores", isAdminVerified, restaurantController.getAllStores);

// Restaurants
router.get("/admin/restaurants", isAdminVerified, restaurantController.getAllRestaurants);
router.get("/admin/restaurants/:id", isAdminVerified, restaurantController.getRestaurantDetail);
router.patch("/admin/restaurants/:id/status", isAdminVerified, restaurantController.toggleRestaurantStatus);
router.put("/admin/restaurants/:id", isAdminVerified, restaurantController.updateRestaurant);

// Users (staff)
router.get("/admin/users", isAdminVerified, dataController.getAllUsers);
router.patch("/admin/users/:id", isAdminVerified, dataController.updateUser);

// Menus
router.get("/admin/menus", isAdminVerified, dataController.getAllMenus);
router.patch("/admin/menus/:menuId/items/:itemId", isAdminVerified, dataController.updateDish);
router.patch("/admin/menus/:id/publish", isAdminVerified, dataController.toggleMenuPublish);

// Orders
router.get("/admin/orders", isAdminVerified, dataController.getAllOrders);
router.patch("/admin/orders/:id", isAdminVerified, dataController.updateOrderStatus);

// Tables
router.get("/admin/tables", isAdminVerified, dataController.getAllTables);
router.patch("/admin/tables/:id", isAdminVerified, dataController.updateTable);

module.exports = router;