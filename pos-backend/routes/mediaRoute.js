const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const { singleImageUpload } = require("../middlewares/uploadHandler");
const { rateLimit } = require("../middlewares/rateLimiter");
const {
  listMedia,
  uploadMedia,
  updateMedia,
  deleteMedia,
} = require("../controllers/mediaController");

// Uploads are expensive (storage + bandwidth); cap them per authenticated user.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => `media-upload:${req.user?._id || "anon"}`,
  message: "Too many uploads. Please wait a moment.",
});

router.route("/")
  .get(isVerifiedUser, listMedia)
  .post(isVerifiedUser, requirePermission("MENU_MANAGE"), uploadLimiter, singleImageUpload, uploadMedia);

router.route("/:id")
  .patch(isVerifiedUser, requirePermission("MENU_MANAGE"), updateMedia)
  .delete(isVerifiedUser, requirePermission("MENU_MANAGE"), deleteMedia);

module.exports = router;
