const express = require("express");
const { requireOnlineOrderingPlan } = require("../services/planFeatures");
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
  updateStaffRole,
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
// Locked on the POS plan alone (services/planFeatures onlineOrdering).
router.route("/order-toggles").put(isVerifiedUser, requireProtectedAction, requireOnlineOrderingPlan, updateOrderToggles);
// Website Timing & Holidays: the website's hours and the table QR's
// ("Restaurant Time"), which the QR obeys, so the Website or the QR Table
// Ordering add-on (services/planFeatures onlineOrdering). A QR-only store was
// held to the default 4 PM opening with no way to change it.
router.route("/timings").put(isVerifiedUser, requireProtectedAction, requireOnlineOrderingPlan, updateChannelTimings);
router.route("/holidays").put(isVerifiedUser, requireProtectedAction, requireOnlineOrderingPlan, updateHolidays);
router.route("/closed-for-today").put(isVerifiedUser, requireProtectedAction, requireOnlineOrderingPlan, toggleClosedForToday);

// Staff Management (Owner Only)
router.route("/staff").post(isVerifiedUser, requireOwnerOnly, addStaffMember);
router.route("/staff").get(isVerifiedUser, requireProtectedAction, getStaffMembers);
router.route("/staff/:staffId").delete(isVerifiedUser, requireOwnerOnly, deleteStaffMember);
router.route("/staff/:staffId").put(isVerifiedUser, requireOwnerOnly, updateStaffRole);

module.exports = router;
