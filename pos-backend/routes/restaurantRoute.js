const express = require("express");
const {
  onboardRestaurant, getMyRestaurant, updateRestaurant,
  addOutlet, getOutlets, updateOutlet, deleteOutlet,
  getFranchiseOverview,
} = require("../controllers/restaurantController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

// Restaurant
router.route("/onboard").post(isVerifiedUser, onboardRestaurant);
router.route("/me").get(isVerifiedUser, getMyRestaurant);
router.route("/franchise").get(isVerifiedUser, getFranchiseOverview);
router.route("/:restaurantId").put(isVerifiedUser, updateRestaurant);

// Outlets
router.route("/:restaurantId/outlets").get(isVerifiedUser, getOutlets);
router.route("/outlets").post(isVerifiedUser, addOutlet);
router.route("/outlets/:outletId").put(isVerifiedUser, updateOutlet);
router.route("/outlets/:outletId").delete(isVerifiedUser, deleteOutlet);

module.exports = router;