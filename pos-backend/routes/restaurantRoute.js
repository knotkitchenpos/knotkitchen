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
  addStaffMember,
  getStaffMembers,
  deleteStaffMember,
} = require("../controllers/restaurantController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

// Restaurant & Store Properties
router.route("/onboard").post(isVerifiedUser, onboardRestaurant);
router.route("/me").get(isVerifiedUser, getMyRestaurant);
router.route("/franchise").get(isVerifiedUser, getFranchiseOverview);
router.route("/properties").get(isVerifiedUser, getStoreProperties);
router.route("/properties").put(isVerifiedUser, updateStoreProperties);

// Protection PIN & POS Settings
router.route("/verify-pin").post(isVerifiedUser, verifyPin);
router.route("/change-pin").put(isVerifiedUser, changePin);
router.route("/pos-settings").put(isVerifiedUser, updatePosSettings);
router.route("/order-toggles").put(isVerifiedUser, updateOrderToggles);
router.route("/timings").put(isVerifiedUser, updateChannelTimings);
router.route("/holidays").put(isVerifiedUser, updateHolidays);

// Staff Management
router.route("/staff").post(isVerifiedUser, addStaffMember);
router.route("/staff").get(isVerifiedUser, getStaffMembers);
router.route("/staff/:staffId").delete(isVerifiedUser, deleteStaffMember);

router.route("/:restaurantId").put(isVerifiedUser, updateRestaurant);

// Outlets
router.route("/:restaurantId/outlets").get(isVerifiedUser, getOutlets);
router.route("/outlets").post(isVerifiedUser, addOutlet);
router.route("/outlets/:outletId").put(isVerifiedUser, updateOutlet);
router.route("/outlets/:outletId").delete(isVerifiedUser, deleteOutlet);

module.exports = router;
