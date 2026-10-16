const express = require("express");
const router = express.Router();
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requirePermission, requireOwnerOnly, requireTypedPin } = require("../middlewares/requirePermission");
const { requireWebsitePlan } = require("../services/planFeatures");
const {
  getWebsiteSettings,
  updateWebsiteSettings,
  validateGatewayCredentials,
} = require("../controllers/websiteSettingsController");
const { getKnotEats, setKnotEats } = require("../controllers/knotEatsController");

/**
 * Authenticated website configuration routes.
 * The tenant is always taken from the session (see websiteSettingsController),
 * so there is no storeId path/body parameter to tamper with.
 */
// One endpoint, several screens. The till reads it as the authoritative
// source for online pricing and channel toggles; Manage Website, Order
// Toggles and Rules & Charges all write through it. The restrictions that
// remain are per field, in the controller -- payment gateway credentials are
// Owner-only there -- plus requireWebsitePlan: Manage Website needs the
// Website add-on; the Rules & Charges fields and the gateway keys (Store
// Properties) pass on every plan; the Order Toggles auto-ready fields need the
// POS plan.
router.route("/settings")
  .get(isVerifiedUser, getWebsiteSettings)
  .put(isVerifiedUser, requireTypedPin(), requireWebsitePlan, updateWebsiteSettings); // N034: PIN typed for this save

router
  .route("/validate-gateway")
  .post(isVerifiedUser, requireOwnerOnly, validateGatewayCredentials);

// Knot Eats opt-in. Anyone signed in may see the status and blockers; only
// the owner may switch it, because switching it on agrees to the fee.
router.route("/knot-eats")
  .get(isVerifiedUser, getKnotEats)
  .put(isVerifiedUser, requireOwnerOnly, setKnotEats);

module.exports = router;
