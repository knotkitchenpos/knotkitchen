const express = require("express");
const {
  getMenus,
  addCategory,
  updateCategory,
  addSubcategory,
  updateSubcategory,
  addDish,
  updateDish,
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
  deleteGroupFromDishes,
  renameGroupInDishes,
  toggleGroupActiveInDishes,
  reorderGroupsInDishes,
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
  downloadCsvTemplate,
  exportCsv,
  previewCsvImport,
  confirmCsvImport,
} = require("../controllers/csvMenuController");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireProtectedAction } = require("../middlewares/requirePermission");
const router = express.Router();

router.route("/").get(isVerifiedUser, getMenus);
router.route("/category").post(isVerifiedUser, requireProtectedAction, addCategory);
router.route("/category").put(isVerifiedUser, requireProtectedAction, updateCategory);
router.route("/subcategory").post(isVerifiedUser, requireProtectedAction, addSubcategory);
router.route("/subcategory").put(isVerifiedUser, requireProtectedAction, updateSubcategory);
router.route("/dish").post(isVerifiedUser, requireProtectedAction, addDish);
router.route("/group").post(isVerifiedUser, requireProtectedAction, saveModifierGroupToDishes);
router.route("/group/delete").post(isVerifiedUser, requireProtectedAction, deleteGroupFromDishes);
router.route("/group/rename").put(isVerifiedUser, requireProtectedAction, renameGroupInDishes);
router.route("/group/toggle-active").post(isVerifiedUser, requireProtectedAction, toggleGroupActiveInDishes);
router.route("/group/reorder").put(isVerifiedUser, requireProtectedAction, reorderGroupsInDishes);
router.route("/group/bulk-add").post(isVerifiedUser, requireProtectedAction, bulkAddGroupToDishes);
router.route("/group/bulk-remove").post(isVerifiedUser, requireProtectedAction, bulkRemoveGroupFromDishes);

// CSV Import / Export (Module 5)
router.route("/csv/template").get(isVerifiedUser, downloadCsvTemplate);
router.route("/csv/export").get(isVerifiedUser, exportCsv);
router.route("/csv/preview").post(isVerifiedUser, requireProtectedAction, previewCsvImport);
router.route("/csv/import").post(isVerifiedUser, requireProtectedAction, confirmCsvImport);

// Structured Text (Notepad) Menu Import
// Declared before "/:menuId/..." routes so "import" is never read as a menuId.
router.route("/import/template").get(isVerifiedUser, downloadTemplate);
router.route("/import/format").get(isVerifiedUser, getFormatDocs);
router.route("/import/preview").post(isVerifiedUser, requireProtectedAction, previewImport);
router.route("/import").post(isVerifiedUser, requireProtectedAction, importMenu);

// Module 6 §4 — Manage Cache. Declared alongside the other top-level
// action routes so the "publish" segment is never treated as a menuId.
router.route("/publish/system").post(isVerifiedUser, requireProtectedAction, publishSystemCache);
router.route("/publish/website").post(isVerifiedUser, requireProtectedAction, publishWebsiteCache);


// Variants

router.route("/:menuId/dish/:itemId/variant").post(isVerifiedUser, requireProtectedAction, addVariant);
router.route("/:menuId/dish/:itemId/variant/:variantId").delete(isVerifiedUser, requireProtectedAction, deleteVariant);

// Add-ons
router.route("/:menuId/dish/:itemId/addon").post(isVerifiedUser, requireProtectedAction, addAddon);
router.route("/:menuId/dish/:itemId/addon/:addonId").delete(isVerifiedUser, requireProtectedAction, deleteAddon);

// Modifier Groups
router.route("/:menuId/dish/:itemId/modifier-group").post(isVerifiedUser, requireProtectedAction, addModifierGroup);
router.route("/:menuId/dish/:itemId/modifier-group/:groupId").delete(isVerifiedUser, requireProtectedAction, deleteModifierGroup);

// Combo Meals
router.route("/:menuId/dish/:itemId/combo").put(isVerifiedUser, requireProtectedAction, toggleCombo);

// Pricing Rules
router.route("/:menuId/dish/:itemId/price-rule").post(isVerifiedUser, requireProtectedAction, addPriceRule);
router.route("/:menuId/dish/:itemId/price-rule/:ruleId").delete(isVerifiedUser, requireProtectedAction, deletePriceRule);

// Availability Scheduling (item level)
router.route("/:menuId/dish/:itemId/schedule").put(isVerifiedUser, requireProtectedAction, updateItemSchedule);

// Time-based Menu (category level)
router.route("/:menuId/schedule").put(isVerifiedUser, requireProtectedAction, updateMenuSchedule);

// Menu Versioning & Publishing
router.route("/:menuId/publish").put(isVerifiedUser, requireProtectedAction, publishMenu);
router.route("/:menuId/unpublish").put(isVerifiedUser, requireProtectedAction, unpublishMenu);
router.route("/:menuId/versions").get(isVerifiedUser, getMenuVersions);
router.route("/:menuId/rollback/:version").put(isVerifiedUser, requireProtectedAction, rollbackMenu);

// Subcategory (POS redesign - optional grouping inside a category)
router.route("/:menuId/dish/:itemId/subcategory").put(isVerifiedUser, requireProtectedAction, updateDishSubcategory);

// Existing
router.route("/:menuId/reorder").put(isVerifiedUser, requireProtectedAction, reorderItems);
router.route("/:menuId/dish/:itemId").put(isVerifiedUser, requireProtectedAction, updateDish);
router.route("/:menuId/dish/:itemId").delete(isVerifiedUser, requireProtectedAction, deleteDish);
router.route("/:menuId/dish/:itemId/availability").put(isVerifiedUser, toggleDishAvailability);
router.route("/:id").delete(isVerifiedUser, requireProtectedAction, deleteMenu);


module.exports = router;