const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const {
  listTableBookings,
  listBookableTables,
  acceptTableBooking,
  cancelTableBooking,
  seatTableBooking,
} = require("../controllers/tableBookingController");

const router = express.Router();

router.get("/", isVerifiedUser, listTableBookings);
router.get("/:id/tables", isVerifiedUser, listBookableTables);
router.post("/:id/accept", isVerifiedUser, acceptTableBooking);
router.post("/:id/cancel", isVerifiedUser, cancelTableBooking);
router.post("/:id/seat", isVerifiedUser, seatTableBooking);

module.exports = router;
