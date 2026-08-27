const express = require("express");
const {
  onboardRestaurant,
  getMyRestaurant,
  updateRestaurant,
  addOutlet,
  getOutlets,
  updateOutlet,
  deleteOutlet,
  getFranchiseOverview,
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
  getActivityLogs,
} = require("../controllers/restaurantController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");
const router = express.Router();

// Restaurant & Store Properties
router.route("/onboard").post(isVerifiedUser, onboardRestaurant);
router.route("/me").get(isVerifiedUser, getMyRestaurant);
router.route("/franchise").get(isVerifiedUser, getFranchiseOverview);
router.route("/properties").get(isVerifiedUser, getStoreProperties);
router.route("/properties").put(isVerifiedUser, requireProtectedAction, updateStoreProperties);

// Protection PIN & POS Settings
router.route("/verify-pin").post(isVerifiedUser, verifyPin);
router.route("/change-pin").put(isVerifiedUser, requireOwnerOnly, changePin);
router.route("/pos-settings").put(isVerifiedUser, requireProtectedAction, updatePosSettings);
router.route("/order-toggles").put(isVerifiedUser, requireProtectedAction, updateOrderToggles);
router.route("/timings").put(isVerifiedUser, requireProtectedAction, updateChannelTimings);
router.route("/holidays").put(isVerifiedUser, requireProtectedAction, updateHolidays);
router.route("/closed-for-today").put(isVerifiedUser, requireProtectedAction, toggleClosedForToday);

// Staff Management (Owner Only)
router.route("/staff").post(isVerifiedUser, requireOwnerOnly, addStaffMember);
router.route("/staff").get(isVerifiedUser, requireProtectedAction, getStaffMembers);
router.route("/staff/:staffId").delete(isVerifiedUser, requireOwnerOnly, deleteStaffMember);

// Activity Logs
router.route("/activity-logs").get(isVerifiedUser, requireProtectedAction, getActivityLogs);

router.route("/:restaurantId").put(isVerifiedUser, updateRestaurant);

// Outlets
router.route("/:restaurantId/outlets").get(isVerifiedUser, getOutlets);
router.route("/outlets").post(isVerifiedUser, addOutlet);
router.route("/outlets/:outletId").put(isVerifiedUser, updateOutlet);
router.route("/outlets/:outletId").delete(isVerifiedUser, deleteOutlet);

module.exports = router;
