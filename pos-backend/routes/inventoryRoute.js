const express = require("express");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");
const c = require("../controllers/inventoryController");

const router = express.Router();

router.route("/ingredients").get(isVerifiedUser, c.listIngredients).post(isVerifiedUser, c.createIngredient);
router.route("/ingredients/:id").put(isVerifiedUser, c.updateIngredient).delete(isVerifiedUser, requireProtectedAction, c.deleteIngredient);
router.route("/movements").get(isVerifiedUser, c.listMovements).post(isVerifiedUser, c.recordMovement);
router.route("/recipes").get(isVerifiedUser, c.listRecipes);
router.route("/recipes/:menuItemId").put(isVerifiedUser, c.upsertRecipe).delete(isVerifiedUser, c.deleteRecipe);

module.exports = router;
