const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");
const { currentShift, openShift, closeShift, listShifts, getShift } = require("../controllers/shiftController");

const router = express.Router();

router.route("/").get(isVerifiedUser, listShifts);
router.route("/current").get(isVerifiedUser, currentShift);
// Opening and closing the drawer are owner or PIN actions.
router.route("/open").post(isVerifiedUser, requireProtectedAction, openShift);
router.route("/close").post(isVerifiedUser, requireProtectedAction, closeShift);
router.route("/:id").get(isVerifiedUser, getShift);

module.exports = router;
