const express = require("express");
const router = express.Router();
const { viewPublicReceipt } = require("../controllers/publicReceiptController");

// Public on purpose -- the signed token IS the authorisation. Mounted at the
// API root (`/r/:token`) so the link that goes out over WhatsApp is short.
router.get("/:token", viewPublicReceipt);

module.exports = router;
