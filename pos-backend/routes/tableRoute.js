const express = require("express");
const { addTable, getTables, getTableById, updateTable, deleteTable, regenerateQr } = require("../controllers/tableController");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");

router.route("/").post(isVerifiedUser, requireProtectedAction, addTable);
router.route("/").get(isVerifiedUser, getTables);
router.route("/:id").get(isVerifiedUser, getTableById);
router.route("/:id/qr/regenerate").put(isVerifiedUser, requireProtectedAction, regenerateQr);
router.route("/:id").put(isVerifiedUser, requireProtectedAction, updateTable);
router.route("/:id").delete(isVerifiedUser, requireProtectedAction, deleteTable);

module.exports = router;