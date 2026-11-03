const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");
const c = require("../controllers/inventoryController");

const router = express.Router();

router.route("/alerts").get(isVerifiedUser, c.listRestockAlerts);
// The POS stock warning, and the two questions the restock alert asks.
router.route("/availability").get(isVerifiedUser, c.stockAvailability);
router.route("/ingredients/:id/turn-off-products").post(isVerifiedUser, c.turnOffProducts);
router.route("/back-in-stock").post(isVerifiedUser, c.answerBack);
router.route("/ingredients").get(isVerifiedUser, c.listIngredients).post(isVerifiedUser, c.createIngredient);
router.route("/ingredients/:id").put(isVerifiedUser, c.updateIngredient).delete(isVerifiedUser, requireProtectedAction, c.deleteIngredient);
router.route("/movements").get(isVerifiedUser, c.listMovements).post(isVerifiedUser, c.recordMovement);
router.route("/recipes").get(isVerifiedUser, c.listRecipes);
router.route("/recipes/:menuItemId").put(isVerifiedUser, c.upsertRecipe).delete(isVerifiedUser, c.deleteRecipe);

// Owner, 2026-11-01: dish costing, add-on recipes, prepared items, stock
// counts, reports and their settings.
router.route("/dish-costs").get(isVerifiedUser, c.dishCosts);
router.route("/addon-recipes").get(isVerifiedUser, c.listAddonRecipes).put(isVerifiedUser, c.saveAddonRecipe);
router.route("/ingredients/:id/make").post(isVerifiedUser, c.makeBatch);
router.route("/counts").get(isVerifiedUser, c.listCounts).post(isVerifiedUser, c.startCount);
router.route("/counts/:id").get(isVerifiedUser, c.getCount).put(isVerifiedUser, c.saveCount);
router.route("/counts/:id/finish").post(isVerifiedUser, c.finishCount);
router.route("/counts/:id/cancel").post(isVerifiedUser, c.cancelCount);
router.route("/report").get(isVerifiedUser, c.inventoryReport);
// Owner, 2026-11-03: a packet's barcode, scanned to add stock or count it.
router.route("/barcodes/:code").get(isVerifiedUser, c.scanBarcode);
// The target food cost and expiry warning are the owner's to set.
router.route("/settings").get(isVerifiedUser, c.getSettings).put(isVerifiedUser, requireProtectedAction, c.saveSettings);

module.exports = router;
