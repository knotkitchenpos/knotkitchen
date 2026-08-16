const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission } = require("../middlewares/requirePermission");
const {
  getWebsiteSettings,
  updateWebsiteSettings,
  previewWebsite,
} = require("../controllers/websiteSettingsController");

/**
 * Authenticated website configuration routes.
 * The tenant is always taken from the session (see websiteSettingsController),
 * so there is no storeId path/body parameter to tamper with.
 */
router.route("/settings")
  .get(isVerifiedUser, requirePermission("SETTINGS_VIEW"), getWebsiteSettings)
  .put(isVerifiedUser, requirePermission("SETTINGS_MANAGE"), updateWebsiteSettings);

router.route("/preview").get(isVerifiedUser, requirePermission("SETTINGS_VIEW"), previewWebsite);

module.exports = router;
