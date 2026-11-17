const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { listActiveForStore } = require("../controllers/announcementController");

// KnotKitchen's announcements for this store's POS (posted in CSD).
const router = express.Router();
router.get("/", isVerifiedUser, listActiveForStore);

module.exports = router;
