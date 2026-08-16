const Menu = require("../models/menuModel");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");

/**
 * Menu tenancy scope (§3).
 *
 * Every mutation on this file goes through menuScopeFor() so that an
 * employee/manager can edit menus belonging to their restaurant even if the
 * menu was originally created by a different POS user (the pre-multi-tenant
 * "createdBy" scoping made staff invisible to owner-created menus and
 * vice-versa — the addition of restaurantId here fixes it while remaining
 * backwards compatible with single-user legacy installs).
 */
const menuScopeFor = (user) => {
  if (user?.restaurantId) {
    const clauses = [{ restaurantId: user.restaurantId }];
    if (user._id) clauses.push({ createdBy: user._id });
    return { $or: clauses };
  }
  return { createdBy: user?._id };
};

const getMenus = async (req, res, next) => {
  try {
    const menus = await Menu.find(menuScopeFor(req.user));
    res.status(200).json({ success: true, data: menus });
  } catch (error) {
    next(error);
  }
};

const addCategory = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      const error = createHttpError(400, "Category name is required!");
      return next(error);
    }

    const existing = await Menu.findOne({ name, ...menuScopeFor(req.user) });
    if (existing) {
      const error = createHttpError(400, "Category already exists!");
      return next(error);
    }

    const menu = new Menu({
      name,
      items: [],
      createdBy: req.user._id,
      // Denormalise the tenant identifiers so cross-restaurant queries can
      // filter menus without a join. Storefront/publicStore both do this.
      restaurantId: req.user?.restaurantId,
      outletId: req.user?.outletId,
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Category added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const addDish = async (req, res, next) => {
  try {
    const { name, price, category, menuId, subcategory } = req.body;
    if (!name || !price || !category) {
      const error = createHttpError(400, "Dish name, price and category are required!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    // Subcategory is optional. Trim + slice defensively to keep it short.
    const cleanSubcategory = typeof subcategory === "string"
      ? subcategory.trim().slice(0, 120)
      : "";

    menu.items.push({ name, price, category, subcategory: cleanSubcategory });
    await menu.save();
    res.status(201).json({ success: true, message: "Dish added!", data: menu });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/menu/:menuId/dish/:itemId/subcategory
 * Set/clear the subcategory a dish belongs to. Tenant-scoped.
 */
const updateDishSubcategory = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    const { subcategory } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(menuId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    const item = menu.items.id(itemId);
    if (!item) return next(createHttpError(404, "Dish not found!"));

    item.subcategory = typeof subcategory === "string"
      ? subcategory.trim().slice(0, 120)
      : "";

    await menu.save();
    res.status(200).json({ success: true, message: "Subcategory updated!", data: menu });
  } catch (error) {
    next(error);
  }
};


// ===== Variants =====
const addVariant = async (req, res, next) => {
  try {
    const { menuId, itemId, name, price } = req.body;
    if (!name || !price) {
      const error = createHttpError(400, "Variant name and price are required!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.variants = item.variants || [];
    item.variants.push({ name, price: Number(price) });
    await menu.save();
    res.status(201).json({ success: true, message: "Variant added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const deleteVariant = async (req, res, next) => {
  try {
    const { menuId, itemId, variantId } = req.params;
    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.variants = (item.variants || []).filter((v) => v._id.toString() !== variantId);
    await menu.save();
    res.status(200).json({ success: true, message: "Variant deleted!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Add-ons =====
const addAddon = async (req, res, next) => {
  try {
    const { menuId, itemId, name, price } = req.body;
    if (!name) {
      const error = createHttpError(400, "Add-on name is required!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.addons = item.addons || [];
    item.addons.push({ name, price: Number(price || 0) });
    await menu.save();
    res.status(201).json({ success: true, message: "Add-on added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const deleteAddon = async (req, res, next) => {
  try {
    const { menuId, itemId, addonId } = req.params;
    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.addons = (item.addons || []).filter((a) => a._id.toString() !== addonId);
    await menu.save();
    res.status(200).json({ success: true, message: "Add-on deleted!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Modifier Groups =====
const addModifierGroup = async (req, res, next) => {
  try {
    const { menuId, itemId, name, required, maxSelections, options } = req.body;
    if (!name) {
      const error = createHttpError(400, "Modifier group name is required!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.modifierGroups = item.modifierGroups || [];
    item.modifierGroups.push({
      name,
      required: Boolean(required),
      maxSelections: Number(maxSelections || 1),
      options: Array.isArray(options) ? options.map((o) => ({ name: o.name, price: Number(o.price || 0) })) : [],
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Modifier group added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const deleteModifierGroup = async (req, res, next) => {
  try {
    const { menuId, itemId, groupId } = req.params;
    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.modifierGroups = (item.modifierGroups || []).filter((g) => g._id.toString() !== groupId);
    await menu.save();
    res.status(200).json({ success: true, message: "Modifier group deleted!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Combo Meals =====
const toggleCombo = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    const { comboDescription, comboItems } = req.body;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.isCombo = !item.isCombo;
    if (item.isCombo) {
      item.comboDescription = comboDescription || "";
      item.comboItems = Array.isArray(comboItems) ? comboItems : [];
    }
    await menu.save();
    res.status(200).json({
      success: true,
      message: item.isCombo ? "Dish marked as combo meal!" : "Dish removed from combo meals!",
      data: menu,
    });
  } catch (error) {
    next(error);
  }
};

// ===== Pricing Rules =====
const addPriceRule = async (req, res, next) => {
  try {
    const { menuId, itemId, name, price, startTime, endTime, daysOfWeek } = req.body;
    if (!name || !price) {
      const error = createHttpError(400, "Rule name and price are required!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.priceRules = item.priceRules || [];
    item.priceRules.push({
      name,
      price: Number(price),
      startTime: startTime || "00:00",
      endTime: endTime || "23:59",
      daysOfWeek: Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Pricing rule added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const deletePriceRule = async (req, res, next) => {
  try {
    const { menuId, itemId, ruleId } = req.params;
    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.priceRules = (item.priceRules || []).filter((r) => r._id.toString() !== ruleId);
    await menu.save();
    res.status(200).json({ success: true, message: "Pricing rule deleted!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Availability Scheduling (item level) =====
const updateItemSchedule = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    const { enabled, startTime, endTime, daysOfWeek } = req.body;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.schedule = {
      enabled: Boolean(enabled),
      startTime: startTime || "09:00",
      endTime: endTime || "23:00",
      daysOfWeek: Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
    };
    await menu.save();
    res.status(200).json({ success: true, message: "Dish schedule updated!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Time-based Menu (category level) =====
const updateMenuSchedule = async (req, res, next) => {
  try {
    const { menuId } = req.params;
    const { enabled, startTime, endTime, daysOfWeek } = req.body;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    menu.schedule = {
      enabled: Boolean(enabled),
      startTime: startTime || "09:00",
      endTime: endTime || "23:00",
      daysOfWeek: Array.isArray(daysOfWeek) && daysOfWeek.length ? daysOfWeek : [0, 1, 2, 3, 4, 5, 6],
    };
    await menu.save();
    res.status(200).json({ success: true, message: "Menu schedule updated!", data: menu });
  } catch (error) {
    next(error);
  }
};

// ===== Menu Versioning & Publishing =====
const publishMenu = async (req, res, next) => {
  try {
    const { menuId } = req.params;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    // Only increment version if coming from unpublished state or new version created
    const newVersion = menu.version + 1;

    // Store snapshot in version history
    menu.versionHistory = menu.versionHistory || [];
    menu.versionHistory.push({
      version: newVersion,
      snapshot: {
        name: menu.name,
        items: JSON.parse(JSON.stringify(menu.items)),
        bgColor: menu.bgColor,
        icon: menu.icon,
      },
    });

    menu.version = newVersion;
    menu.published = true;
    menu.publishedAt = new Date();
    await menu.save();

    res.status(200).json({
      success: true,
      message: `Menu published as version ${newVersion}!`,
      data: menu,
    });
  } catch (error) {
    next(error);
  }
};

const unpublishMenu = async (req, res, next) => {
  try {
    const { menuId } = req.params;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    menu.published = false;
    await menu.save();

    res.status(200).json({ success: true, message: "Menu unpublished!", data: menu });
  } catch (error) {
    next(error);
  }
};

const getMenuVersions = async (req, res, next) => {
  try {
    const { menuId } = req.params;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    res.status(200).json({
      success: true,
      data: {
        currentVersion: menu.version,
        published: menu.published,
        publishedAt: menu.publishedAt,
        history: menu.versionHistory || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

const rollbackMenu = async (req, res, next) => {
  try {
    const { menuId, version } = req.params;

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    const snapshot = (menu.versionHistory || []).find((v) => v.version === Number(version));
    if (!snapshot) {
      const error = createHttpError(404, `Version ${version} not found!`);
      return next(error);
    }

    // Restore snapshot
    menu.name = snapshot.snapshot.name;
    menu.items = snapshot.snapshot.items;
    menu.bgColor = snapshot.snapshot.bgColor;
    menu.icon = snapshot.snapshot.icon;
    menu.version = Number(version);
    menu.published = true;
    menu.publishedAt = new Date();

    await menu.save();
    res.status(200).json({
      success: true,
      message: `Menu rolled back to version ${version}!`,
      data: menu,
    });
  } catch (error) {
    next(error);
  }
};

const deleteMenu = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const menu = await Menu.findOneAndDelete({ _id: id, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    res.status(200).json({ success: true, message: "Menu deleted!" });
  } catch (error) {
    next(error);
  }
};

const deleteDish = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(menuId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const itemIndex = menu.items.findIndex((item) => item._id.toString() === itemId);
    if (itemIndex === -1) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    menu.items.splice(itemIndex, 1);
    await menu.save();
    res.status(200).json({ success: true, message: "Dish deleted!", data: menu });
  } catch (error) {
    next(error);
  }
};

const toggleDishAvailability = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(menuId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      const error = createHttpError(404, "Invalid id!");
      return next(error);
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    item.isAvailable = !item.isAvailable;
    await menu.save();
    res.status(200).json({
      success: true,
      message: item.isAvailable ? "Dish is now available!" : "Dish is now out of stock!",
      data: menu,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
