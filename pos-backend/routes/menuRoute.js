const express = require("express");
const {
  getMenus,
  addCategory,
  addSubcategory,
  addDish,
  updateDishSubcategory,
  deleteMenu,
  deleteDish,
  reorderItems,
  toggleDishAvailability,

  addVariant,
  deleteVariant,
  addAddon,
  deleteAddon,
  addModifierGroup,
  saveModifierGroupToDishes,
  bulkAddGroupToDishes,
  bulkRemoveGroupFromDishes,
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
  publishSystemCache,
  publishWebsiteCache,
} = require("../controllers/menuController");

const {
  downloadTemplate,
  getFormatDocs,
  previewImport,
  importMenu,
} = require("../controllers/menuImportController");

const {
  exportCsv,
  previewCsvImport,
  confirmCsvImport,
} = require("../controllers/csvMenuController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const router = express.Router();

router.route("/").get(isVerifiedUser, getMenus);
router.route("/category").post(isVerifiedUser, addCategory);
router.route("/subcategory").post(isVerifiedUser, addSubcategory);
router.route("/dish").post(isVerifiedUser, addDish);
router.route("/group").post(isVerifiedUser, saveModifierGroupToDishes);
router.route("/group/bulk-add").post(isVerifiedUser, bulkAddGroupToDishes);
router.route("/group/bulk-remove").post(isVerifiedUser, bulkRemoveGroupFromDishes);

// CSV Import / Export (Module 5)
router.route("/csv/export").get(isVerifiedUser, exportCsv);
router.route("/csv/preview").post(isVerifiedUser, previewCsvImport);
router.route("/csv/import").post(isVerifiedUser, confirmCsvImport);

// Structured Text (Notepad) Menu Import
// Declared before "/:menuId/..." routes so "import" is never read as a menuId.
router.route("/import/template").get(isVerifiedUser, downloadTemplate);
router.route("/import/format").get(isVerifiedUser, getFormatDocs);
router.route("/import/preview").post(isVerifiedUser, previewImport);
router.route("/import").post(isVerifiedUser, importMenu);

// Module 6 §4 — Manage Cache. Declared alongside the other top-level
// action routes so the "publish" segment is never treated as a menuId.
router.route("/publish/system").post(isVerifiedUser, publishSystemCache);
router.route("/publish/website").post(isVerifiedUser, publishWebsiteCache);


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
router.route("/:menuId/reorder").put(isVerifiedUser, reorderItems);
router.route("/:menuId/dish/:itemId").delete(isVerifiedUser, deleteDish);
router.route("/:menuId/dish/:itemId/availability").put(isVerifiedUser, toggleDishAvailability);
router.route("/:id").delete(isVerifiedUser, deleteMenu);


module.exports = router;