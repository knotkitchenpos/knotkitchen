const express = require("express");
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
const { requireOwnerOnly, requireProtectedAction, requireTypedPin } = require("../middlewares/requirePermission");
const router = express.Router();

// Restaurant & Store Properties
router.route("/me").get(isVerifiedUser, getMyRestaurant);
router.route("/properties").get(isVerifiedUser, getStoreProperties);
router.route("/properties").put(isVerifiedUser, requireProtectedAction, updateStoreProperties);

// Protection PIN & POS Settings
router.route("/verify-pin").post(isVerifiedUser, verifyPin);
router.route("/change-pin").put(isVerifiedUser, requireOwnerOnly, changePin);
// N034: settings saves need the PIN typed for that save (requireTypedPin), not an earlier 15-minute token.
router.route("/pos-settings").put(isVerifiedUser, requireTypedPin(), updatePosSettings);
// Locked on the Billing plan (middlewares/planGate); open on the POS plan.
router.route("/order-toggles").put(isVerifiedUser, requireTypedPin(), updateOrderToggles);
// Website Timing & Holidays: the website's, table QR's and Knot Eats' hours.
// Open on the POS plan; on the Billing plan only with the Website add-on
// (middlewares/planGate BILLING_WITH_ADDON, services/planFeatures websiteHours).
router.route("/timings").put(isVerifiedUser, requireTypedPin(), updateChannelTimings);
router.route("/holidays").put(isVerifiedUser, requireTypedPin(), updateHolidays);
router.route("/closed-for-today").put(isVerifiedUser, requireTypedPin(), toggleClosedForToday);

// Staff Management (Owner Only)
router.route("/staff").post(isVerifiedUser, requireOwnerOnly, addStaffMember);
router.route("/staff").get(isVerifiedUser, requireProtectedAction, getStaffMembers);
// N032: deleting staff or changing a role asks the owner for the PIN too.
router.route("/staff/:staffId").delete(isVerifiedUser, requireOwnerOnly, requireTypedPin({ evenOwner: true }), deleteStaffMember);
router.route("/staff/:staffId").put(isVerifiedUser, requireOwnerOnly, requireTypedPin({ evenOwner: true }), updateStaffRole);

module.exports = router;
