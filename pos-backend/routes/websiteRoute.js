const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission, requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");
const { csdOnly } = require("../middlewares/csdOnly");
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
// This endpoint is NOT the Manage Website screen. The till reads it as the
// authoritative source for online pricing and channel toggles, and POS
// Settings legitimately writes `ordering`, `couponsConfig` and
// `freeItemConfig` through it (Order Toggles, Rules & Charges).
//
// So the lock is per FIELD, in the controller -- see CSD_ONLY_FIELDS there.
// Locking the whole route would have taken Order Toggles and Rules down with
// Manage Website.
router.route("/settings")
  .get(isVerifiedUser, getWebsiteSettings)
  .put(isVerifiedUser, requireProtectedAction, updateWebsiteSettings);

router.route("/preview").get(isVerifiedUser, previewWebsite);
router
  .route("/validate-gateway")
  .post(isVerifiedUser, csdOnly("Manage Website"), requireOwnerOnly, validateGatewayCredentials);

module.exports = router;
