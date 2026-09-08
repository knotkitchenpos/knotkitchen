const express = require("express");
const {
  createTeam, getTeams, updateTeam, deleteTeam,
  addMemberToTeam, removeMemberFromTeam,
  addStaff, getStaff, updateStaff, deleteStaff,
  getAuditLogs, getRolePermissions,
} = require("../controllers/teamController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { csdOnly } = require("../middlewares/csdOnly");
const router = express.Router();

router.route("/").post(isVerifiedUser, createTeam);
router.route("/:restaurantId").get(isVerifiedUser, getTeams);
router.route("/:teamId").put(isVerifiedUser, updateTeam);
router.route("/:teamId").delete(isVerifiedUser, deleteTeam);
router.route("/:teamId/members/:userId").post(isVerifiedUser, addMemberToTeam);
router.route("/:teamId/members/:userId").delete(isVerifiedUser, removeMemberFromTeam);

router.route("/staff").post(isVerifiedUser, addStaff);
router.route("/staff/:restaurantId").get(isVerifiedUser, getStaff);
router.route("/staff/:userId").put(isVerifiedUser, updateStaff);
router.route("/staff/:userId").delete(isVerifiedUser, deleteStaff);

// Activity Log is CSD-only. CSD reads it through its own routes
// (/csd/restaurants/:storeId/activity and /csd/reports/audit).
router.route("/audit/:restaurantId").get(isVerifiedUser, csdOnly("Activity Log"), getAuditLogs);
router.route("/roles/permissions").get(isVerifiedUser, getRolePermissions);

module.exports = router;