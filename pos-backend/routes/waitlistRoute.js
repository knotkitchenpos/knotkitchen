const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const waitlist = require("../controllers/waitlistController");

// Waitlist for busy hours (POS plan; planGate keeps it off the Billing plan).
const router = express.Router();
router.get("/", isVerifiedUser, waitlist.list);
router.post("/", isVerifiedUser, waitlist.add);
router.post("/:id/notify", isVerifiedUser, waitlist.notify);
router.post("/:id/seat", isVerifiedUser, waitlist.seat);
router.post("/:id/leave", isVerifiedUser, waitlist.leave);

module.exports = router;
