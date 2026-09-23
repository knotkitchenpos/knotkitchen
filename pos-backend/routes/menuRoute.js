const express = require("express");
const {
  getMenus,
  addCategory,
  updateCategory,
  addSubcategory,
  updateSubcategory,
  addDish,
  updateDish,
  deleteMenu,
  deleteDish,
  deleteDishes,
  reorderItems,
  reorderMenus,
  toggleDishAvailability,
  saveModifierGroupToDishes,
  deleteGroupFromDishes,
  toggleGroupActiveInDishes,
  reorderGroupsInDishes,
  bulkAddGroupToDishes,
  bulkRemoveGroupFromDishes,
  publishMenu,
  unpublishMenu,
  publishSystemCache,
  publishWebsiteCache,
} = require("../controllers/menuController");

const {
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

// Bulk delete — one atomic $pull. Looping the single-dish route instead races
// the same document's version and 500s on everything after the first.
router.route("/:menuId/dishes").delete(isVerifiedUser, requireProtectedAction, deleteDishes);
router.route("/group").post(isVerifiedUser, requireProtectedAction, saveModifierGroupToDishes);
router.route("/group/delete").post(isVerifiedUser, requireProtectedAction, deleteGroupFromDishes);
router.route("/group/toggle-active").post(isVerifiedUser, requireProtectedAction, toggleGroupActiveInDishes);
router.route("/group/reorder").put(isVerifiedUser, requireProtectedAction, reorderGroupsInDishes);
router.route("/group/bulk-add").post(isVerifiedUser, requireProtectedAction, bulkAddGroupToDishes);
router.route("/group/bulk-remove").post(isVerifiedUser, requireProtectedAction, bulkRemoveGroupFromDishes);

// CSV Import / Export (Module 5)
router.route("/csv/export").get(isVerifiedUser, exportCsv);
router.route("/csv/preview").post(isVerifiedUser, requireProtectedAction, previewCsvImport);
router.route("/csv/import").post(isVerifiedUser, requireProtectedAction, confirmCsvImport);

// Module 6 §4 — Manage Cache. Declared alongside the other top-level
// action routes so the "publish" segment is never treated as a menuId.
router.route("/publish/system").post(isVerifiedUser, requireProtectedAction, publishSystemCache);
router.route("/publish/website").post(isVerifiedUser, requireProtectedAction, publishWebsiteCache);

// Drag-and-drop category reorder. Kept alongside the other top-level
// action routes so the "reorder-categories" segment is never read as a
// menuId by the "/:menuId" catch-all further down.
router.route("/reorder-categories").put(isVerifiedUser, requireProtectedAction, reorderMenus);

// Menu Publishing
router.route("/:menuId/publish").put(isVerifiedUser, requireProtectedAction, publishMenu);
router.route("/:menuId/unpublish").put(isVerifiedUser, requireProtectedAction, unpublishMenu);

router.route("/:menuId/reorder").put(isVerifiedUser, requireProtectedAction, reorderItems);
router.route("/:menuId/dish/:itemId").put(isVerifiedUser, requireProtectedAction, updateDish);
router.route("/:menuId/dish/:itemId").delete(isVerifiedUser, requireProtectedAction, deleteDish);
router.route("/:menuId/dish/:itemId/availability").put(isVerifiedUser, toggleDishAvailability);
router.route("/:id").delete(isVerifiedUser, requireProtectedAction, deleteMenu);


module.exports = router;