const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission, requireOwnerOnly, requireProtectedAction } = require("../middlewares/requirePermission");
const { requireWebsitePlan, requirePaymentGatewayPlan } = require("../services/planFeatures");
const {
  getWebsiteSettings,
  updateWebsiteSettings,
  validateGatewayCredentials,
} = require("../controllers/websiteSettingsController");

/**
 * Authenticated website configuration routes.
 * The tenant is always taken from the session (see websiteSettingsController),
 * so there is no storeId path/body parameter to tamper with.
 */
// One endpoint, several screens. The till reads it as the authoritative
// source for online pricing and channel toggles; Manage Website, Order
// Toggles and Rules & Charges all write through it. The restrictions that
// remain are per field, in the controller -- payment gateway credentials are
// Owner-only there -- plus requireWebsitePlan: Manage Website needs Growth or
// Scale, while the Order Toggles / Rules & Charges fields pass on any plan.
router.route("/settings")
  .get(isVerifiedUser, getWebsiteSettings)
  .put(isVerifiedUser, requireProtectedAction, requireWebsitePlan, updateWebsiteSettings);

router
  .route("/validate-gateway")
  .post(isVerifiedUser, requireOwnerOnly, requirePaymentGatewayPlan, validateGatewayCredentials);

module.exports = router;
