const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { requireTableQrPlan } = require("../services/planFeatures");
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
// Table QR ordering is Growth and Scale only (services/planFeatures).
router.route("/table/:tableId").get(isVerifiedUser, requirePermission("TABLE_READ"), requireTableQrPlan, getOrCreateQr);

// Admin: regenerate QR (invalidates previous token)
router.route("/table/:tableId/regenerate").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), requireTableQrPlan, regenerateQr);

// Admin: revoke a QR
router.route("/:id/revoke").post(isVerifiedUser, requirePermission("TABLE_UPDATE"), revokeQr);

// Admin: mark download / print
router.route("/:id/usage").post(isVerifiedUser, requirePermission("TABLE_READ"), markUsage);

module.exports = router;