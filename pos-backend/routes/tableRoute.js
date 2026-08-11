const express = require("express");
const { addTable, getTables, getTableById, updateTable, deleteTable, regenerateQr } = require("../controllers/tableController");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification")

router.route("/").post(isVerifiedUser, addTable);
router.route("/").get(isVerifiedUser, getTables);
router.route("/:id").get(isVerifiedUser, getTableById);
router.route("/:id/qr/regenerate").put(isVerifiedUser, regenerateQr);
router.route("/:id").put(isVerifiedUser, updateTable);
router.route("/:id").delete(isVerifiedUser, deleteTable);

module.exports = router;