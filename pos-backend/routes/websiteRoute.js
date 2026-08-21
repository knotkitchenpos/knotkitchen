const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission, requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");
const {
  getWebsiteSettings,
  updateWebsiteSettings,
  previewWebsite,
  validateGatewayCredentials,
} = require("../controllers/websiteSettingsController");

/**
 * Authenticated website configuration routes.
 * The tenant is always taken from the session (see websiteSettingsController),
 * so there is no storeId path/body parameter to tamper with.
 */
router.route("/settings")
  .get(isVerifiedUser, getWebsiteSettings)
  .put(isVerifiedUser, requireProtectedAction, updateWebsiteSettings);

router.route("/preview").get(isVerifiedUser, previewWebsite);
router.route("/validate-gateway").post(isVerifiedUser, requireOwnerOnly, validateGatewayCredentials);

module.exports = router;
