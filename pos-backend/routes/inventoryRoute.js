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

module.exports = router;
