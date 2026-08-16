const express = require("express");
const {
  getMenus,
  addCategory,
  addDish,
  updateDishSubcategory,
  deleteMenu,
  deleteDish,
  toggleDishAvailability,

  addVariant,
  deleteVariant,
  addAddon,
  deleteAddon,
  addModifierGroup,
  deleteModifierGroup,
  toggleCombo,
  addPriceRule,
  deletePriceRule,
  updateItemSchedule,
  updateMenuSchedule,
  publishMenu,
  unpublishMenu,
  getMenuVersions,
  rollbackMenu,
} = require("../controllers/menuController");
const {
  downloadTemplate,
  getFormatDocs,
  previewImport,
  importMenu,
} = require("../controllers/menuImportController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

router.route("/").get(isVerifiedUser, getMenus);
router.route("/category").post(isVerifiedUser, addCategory);
router.route("/dish").post(isVerifiedUser, addDish);

// Structured Text (Notepad) Menu Import
// Declared before "/:menuId/..." routes so "import" is never read as a menuId.
router.route("/import/template").get(isVerifiedUser, downloadTemplate);
router.route("/import/format").get(isVerifiedUser, getFormatDocs);
router.route("/import/preview").post(isVerifiedUser, previewImport);
router.route("/import").post(isVerifiedUser, importMenu);


// Variants
router.route("/:menuId/dish/:itemId/variant").post(isVerifiedUser, addVariant);
router.route("/:menuId/dish/:itemId/variant/:variantId").delete(isVerifiedUser, deleteVariant);

// Add-ons
router.route("/:menuId/dish/:itemId/addon").post(isVerifiedUser, addAddon);
router.route("/:menuId/dish/:itemId/addon/:addonId").delete(isVerifiedUser, deleteAddon);

// Modifier Groups
router.route("/:menuId/dish/:itemId/modifier-group").post(isVerifiedUser, addModifierGroup);
router.route("/:menuId/dish/:itemId/modifier-group/:groupId").delete(isVerifiedUser, deleteModifierGroup);

// Combo Meals
router.route("/:menuId/dish/:itemId/combo").put(isVerifiedUser, toggleCombo);

// Pricing Rules
router.route("/:menuId/dish/:itemId/price-rule").post(isVerifiedUser, addPriceRule);
router.route("/:menuId/dish/:itemId/price-rule/:ruleId").delete(isVerifiedUser, deletePriceRule);

// Availability Scheduling (item level)
router.route("/:menuId/dish/:itemId/schedule").put(isVerifiedUser, updateItemSchedule);

// Time-based Menu (category level)
router.route("/:menuId/schedule").put(isVerifiedUser, updateMenuSchedule);

// Menu Versioning & Publishing
router.route("/:menuId/publish").put(isVerifiedUser, publishMenu);
router.route("/:menuId/unpublish").put(isVerifiedUser, unpublishMenu);
router.route("/:menuId/versions").get(isVerifiedUser, getMenuVersions);
router.route("/:menuId/rollback/:version").put(isVerifiedUser, rollbackMenu);

// Subcategory (POS redesign - optional grouping inside a category)
router.route("/:menuId/dish/:itemId/subcategory").put(isVerifiedUser, updateDishSubcategory);

// Existing
router.route("/:menuId/dish/:itemId").delete(isVerifiedUser, deleteDish);
router.route("/:menuId/dish/:itemId/availability").put(isVerifiedUser, toggleDishAvailability);
router.route("/:id").delete(isVerifiedUser, deleteMenu);


module.exports = router;