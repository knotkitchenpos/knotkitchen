// Managing tables (add, edit, delete, settings) comes with the QR Table
// Ordering add-on; reading them and freeing one stay open.
const { requireTableQrPlan } = require("../services/planFeatures");
const express = require("express");
const { addTable, getTables, getTableById, updateTable, deleteTable, regenerateQr, getTableSettings, updateTableSettings, releaseTable } = require("../controllers/tableController");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction, requirePermission } = require("../middlewares/requirePermission");

router.route("/").post(isVerifiedUser, requireProtectedAction, requireTableQrPlan, addTable);
router.route("/").get(isVerifiedUser, getTables);
// Declared BEFORE /:id, or "settings" would be read as a table id.
router.route("/settings").get(isVerifiedUser, getTableSettings);
router.route("/settings").put(isVerifiedUser, requireProtectedAction, requireTableQrPlan, updateTableSettings);

router.route("/:id").get(isVerifiedUser, getTableById);
router.route("/:id/qr/regenerate").put(isVerifiedUser, requireProtectedAction, regenerateQr);
// Put a stranded table back into service. Everyday floor work, so it takes the
// ordinary table permission rather than the owner PIN -- a table nobody can
// use is worse than one released early, and it refuses while an order is live.
router.route("/:id/release").put(isVerifiedUser, requirePermission("TABLE_UPDATE"), releaseTable);
router.route("/:id").put(isVerifiedUser, requireProtectedAction, requireTableQrPlan, updateTable);
router.route("/:id").delete(isVerifiedUser, requireProtectedAction, requireTableQrPlan, deleteTable);

module.exports = router;