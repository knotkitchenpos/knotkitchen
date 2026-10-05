const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { rateLimit } = require("../middlewares/rateLimiter");
const { createSupportRequest } = require("../controllers/supportController");

const router = express.Router();

// Per store: a few real requests an hour is plenty; a stuck button is not.
const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => `support-request:${req.user?.storeId || req.user?._id || "anon"}`,
  message: "Too many support requests. Please call support instead.",
});

router.post("/requests", isVerifiedUser, requestLimiter, createSupportRequest);

module.exports = router;
