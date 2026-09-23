const express = require("express");
const { requireWebsitePlan } = require("../services/planFeatures");
const {
  getMyRestaurant,
  getStoreProperties,
  updateStoreProperties,
  verifyPin,
  changePin,
  updatePosSettings,
  updateOrderToggles,
  updateChannelTimings,
  updateHolidays,
  toggleClosedForToday,
  addStaffMember,
  getStaffMembers,
  deleteStaffMember,
} = require("../controllers/restaurantController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");
const router = express.Router();

// Restaurant & Store Properties
router.route("/me").get(isVerifiedUser, getMyRestaurant);
router.route("/properties").get(isVerifiedUser, getStoreProperties);
router.route("/properties").put(isVerifiedUser, requireProtectedAction, updateStoreProperties);

// Protection PIN & POS Settings
router.route("/verify-pin").post(isVerifiedUser, verifyPin);
router.route("/change-pin").put(isVerifiedUser, requireOwnerOnly, changePin);
router.route("/pos-settings").put(isVerifiedUser, requireProtectedAction, updatePosSettings);
router.route("/order-toggles").put(isVerifiedUser, requireProtectedAction, updateOrderToggles);
// Website Timing & Holidays: the website's hours, so only plans with the website (services/planFeatures).
router.route("/timings").put(isVerifiedUser, requireProtectedAction, requireWebsitePlan, updateChannelTimings);
router.route("/holidays").put(isVerifiedUser, requireProtectedAction, requireWebsitePlan, updateHolidays);
router.route("/closed-for-today").put(isVerifiedUser, requireProtectedAction, requireWebsitePlan, toggleClosedForToday);

// Staff Management (Owner Only)
router.route("/staff").post(isVerifiedUser, requireOwnerOnly, addStaffMember);
router.route("/staff").get(isVerifiedUser, requireProtectedAction, getStaffMembers);
router.route("/staff/:staffId").delete(isVerifiedUser, requireOwnerOnly, deleteStaffMember);

module.exports = router;
