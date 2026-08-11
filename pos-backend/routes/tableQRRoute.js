const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const {
  getOrCreateQr,
  regenerateQr,
  listQrs,
  revokeQr,
  markUsage,
} = require("../controllers/tableQRController");

const router = express.Router();

// Admin: list all QR records for the tenant/outlet
router.route("/").get(isVerifiedUser, requirePermission("TABLE_READ"), listQrs);

// Admin: get-or-create QR for a table
router.route("/table/:tableId").get(isVerifiedUser, requirePermission("TABLE_READ"), getOrCreateQr);

// Admin: regenerate QR (invalidates previous token)
router.route("/table/:tableId/regenerate").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), regenerateQr);

// Admin: revoke a QR
router.route("/:id/revoke").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), revokeQr);

// Admin: mark download / print
router.route("/:id/usage").post(isVerifiedUser, requirePermission("TABLE_READ"), markUsage);

module.exports = router;