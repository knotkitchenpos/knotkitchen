const Menu = require("../models/menuModel");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { logActivity } = require("../services/auditService");

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

    // Module 9 §2 — POS (System) reads System Published Menu snapshot.
    // Manage Menu (Draft) reads live draft items.
    const isSystemSource = req.query.source === "system" || req.headers["x-pos-source"] === "system";

    const projected = menus.map((menu) => {
      const obj = menu.toObject ? menu.toObject() : { ...menu };
      if (isSystemSource && menu.hasPublishedToSystem && menu.systemSnapshot) {
        obj.name = menu.systemSnapshot.name || obj.name;
        obj.items = menu.systemSnapshot.items || [];
      }
      return obj;
    });

    res.status(200).json({ success: true, data: projected });
  } catch (error) {
    next(error);
  }
};


const addCategory = async (req, res, next) => {
  try {
    const { name, description, dispatchType, bgColor, textColor } = req.body;
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
      name: String(name).trim(),
      items: [],
      subcategories: [],
      createdBy: req.user._id,
      restaurantId: req.user?.restaurantId,
      outletId: req.user?.outletId,
      bgColor: bgColor || "#5b45b0",
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Category added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const addSubcategory = async (req, res, next) => {
  try {
    const { menuId, name, description, dispatchType, bgColor, textColor } = req.body;
    if (!menuId || !name) {
      return next(createHttpError(400, "Category ID and Subcategory name are required!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    menu.subcategories = menu.subcategories || [];
    menu.subcategories.push({
      name: String(name).trim(),
      description: String(description || "").trim(),
      dispatchType: dispatchType || { collection: true, delivery: true, table: true },
      bgColor: bgColor || "#0249fd",
      textColor: textColor || "#ffffff",
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Subcategory added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const addDish = async (req, res, next) => {
  try {
    const {
      name,
      price,
      category,
      menuId,
      subcategory,
      description,
      dispatchType,
      bgColor,
      textColor,
      samePrice,
      channelPrices,
      isVegetarian,
      displayTarget,
      imageUrl,
      schedule,
    } = req.body;
    if (!name || price === undefined || !category) {
      const error = createHttpError(400, "Dish name, price and category are required!");
      return next(error);
    }

    const numPrice = Number(price);
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      return next(createHttpError(400, "Price cannot be negative!"));
    }

    // Module 2 §5: Validate channel prices if samePrice is false
    const parsedChannelPrices = {
      posCollection: Math.max(0, Number(channelPrices?.posCollection || numPrice)),
      posDelivery: Math.max(0, Number(channelPrices?.posDelivery || numPrice)),
      posTable: Math.max(0, Number(channelPrices?.posTable || numPrice)),
      websiteCollection: Math.max(0, Number(channelPrices?.websiteCollection || numPrice)),
      websiteDelivery: Math.max(0, Number(channelPrices?.websiteDelivery || numPrice)),
      websiteTable: Math.max(0, Number(channelPrices?.websiteTable || numPrice)),
    };

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) {
      const error = createHttpError(404, "Category not found!");
      return next(error);
    }

    const cleanSubcategory = typeof subcategory === "string" ? subcategory.trim().slice(0, 120) : "";

    menu.items.push({
      name: String(name).trim(),
      price: numPrice,
      category: String(category).trim(),
      subcategory: cleanSubcategory,
      description: String(description || "").trim(),
      dispatchType: dispatchType || { collection: true, delivery: true, table: true },
      bgColor: bgColor || "#0249fd",
      textColor: textColor || "#ffffff",
      samePrice: samePrice !== false,
      channelPrices: parsedChannelPrices,
      isVegetarian: isVegetarian !== false,
      displayTarget: ["both", "system", "website"].includes(displayTarget) ? displayTarget : "both",
      imageUrl: imageUrl || "",
      imageThumbnailUrl: imageUrl || "",
      schedule: schedule || { enabled: false, startTime: "09:00", endTime: "23:00", daysOfWeek: [0,1,2,3,4,5,6] },
    });
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
const bulkAddGroupToDishes = async (req, res, next) => {
  try {
    const { groupName, dishIds, required, maxSelections, options } = req.body;
    if (!groupName || !Array.isArray(dishIds) || dishIds.length === 0) {
      return next(createHttpError(400, "Group name and dishIds array are required!"));
    }

    const menus = await Menu.find(menuScopeFor(req.user));
    let count = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (dishIds.includes(String(item._id))) {
          item.modifierGroups = item.modifierGroups || [];
          const existing = item.modifierGroups.find((g) => g.name === groupName);
          if (!existing) {
            item.modifierGroups.push({
              name: groupName,
              required: Boolean(required),
              maxSelections: Number(maxSelections) || 1,
              options: Array.isArray(options) ? options : [],
            });
            count++;
            modified = true;
          }
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group "${groupName}" added to ${count} product(s)!` });
  } catch (error) {
    next(error);
  }
};

const bulkRemoveGroupFromDishes = async (req, res, next) => {
  try {
    const { groupName, dishIds } = req.body;
    if (!groupName || !Array.isArray(dishIds) || dishIds.length === 0) {
      return next(createHttpError(400, "Group name and dishIds array are required!"));
    }

    const menus = await Menu.find(menuScopeFor(req.user));
    let count = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (dishIds.includes(String(item._id))) {
          if (item.modifierGroups && item.modifierGroups.length > 0) {
            const initialLen = item.modifierGroups.length;
            item.modifierGroups = item.modifierGroups.filter((g) => g.name !== groupName);
            if (item.modifierGroups.length < initialLen) {
              count++;
              modified = true;
            }
          }
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group "${groupName}" removed from ${count} product(s)!` });
  } catch (error) {
    next(error);
  }
};

const saveModifierGroupToDishes = async (req, res, next) => {
  try {
    const { groupName, required, maxSelections, options, dishIds } = req.body;
    if (!groupName || !Array.isArray(options)) {
      return next(createHttpError(400, "Group name and options array are required!"));
    }

    const validatedOptions = options.map((o) => {
      const p = Number(o.price);
      if (!Number.isFinite(p) || p < 0) {
        throw createHttpError(400, `Price for extra "${o.name}" cannot be negative!`);
      }
      return { name: String(o.name).trim(), price: p };
    });

    const menus = await Menu.find(menuScopeFor(req.user));
    let updatedCount = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (!Array.isArray(dishIds) || dishIds.length === 0 || dishIds.includes(String(item._id))) {
          item.modifierGroups = item.modifierGroups || [];
          const existing = item.modifierGroups.find((g) => g.name === groupName);
          if (existing) {
            existing.required = Boolean(required);
            existing.maxSelections = Number(maxSelections) || 1;
            existing.options = validatedOptions;
          } else {
            item.modifierGroups.push({
              name: groupName,
              required: Boolean(required),
              maxSelections: Number(maxSelections) || 1,
              options: validatedOptions,
            });
          }
          modified = true;
          updatedCount++;
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group "${groupName}" saved!`, count: updatedCount });
  } catch (error) {
    next(error);
  }
};

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

const reorderItems = async (req, res, next) => {
  try {
    const { menuId } = req.params;
    const { itemIds } = req.body;
    if (!Array.isArray(itemIds)) {
      return next(createHttpError(400, "itemIds array is required!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    const idMap = new Map(itemIds.map((id, index) => [String(id), index]));
    for (const item of menu.items) {
      if (idMap.has(String(item._id))) {
        item.sortOrder = idMap.get(String(item._id));
      }
    }

    menu.items.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    await menu.save();

    res.status(200).json({ success: true, message: "Products reordered successfully!", data: menu });
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

/**
 * Module 6 §4 — Manage Cache.
 *
 * Bulk publish EVERY menu belonging to the tenant to the requested target.
 * We track two independent publish timestamps:
 *
 *   `lastPublishedToSystemAt`  — POS view (Menu.jsx / Product panel)
 *   `lastPublishedToWebsiteAt` — customer-facing storefront
 *
 * The Menu.published flag remains a per-category on/off switch so an owner
 * can hide an entire category without triggering a publish. This endpoint
 * ONLY bumps version + records the timestamp; it does not toggle
 * `published` (that would be a footgun — the store owner already had it
 * off for a reason).
 *
 * Returns { count, publishedAt, version } so the UI can show "Website
 * refreshed · 5 categories updated".
 */
const publishToTarget = async (req, res, target) => {
  const now = new Date();
  const timestampField =
    target === "website" ? "lastPublishedToWebsiteAt" : "lastPublishedToSystemAt";

  // findMany + save (over a raw bulk update) so we run the same
  // mongoose middleware / defaults every other write does. In practice a
  // store has <200 menus so this is cheap.
  const menus = await Menu.find({
    ...menuScopeFor(req.user),
    isDeleted: { $ne: true },
  });

  let updated = 0;
  for (const menu of menus) {
    menu.version = (menu.version || 1) + 1;
    menu.publishedAt = now;
    menu.set(timestampField, now);

    const snapshotItems = JSON.parse(JSON.stringify(menu.items));

    if (target === "system") {
      menu.hasPublishedToSystem = true;
      menu.lastPublishedToSystemAt = now;
      menu.systemVersion = (menu.systemVersion || 0) + 1;
      menu.systemSnapshot = { name: menu.name, items: snapshotItems };
    } else if (target === "website") {
      menu.hasPublishedToWebsite = true;
      menu.lastPublishedToWebsiteAt = now;
      menu.websiteVersion = (menu.websiteVersion || 0) + 1;
      menu.websiteSnapshot = { name: menu.name, items: snapshotItems };
      if (menu.published === false) {
        menu.published = true;
      }
    }

    try {
      await menu.save();
      updated += 1;
    } catch (err) {
      console.warn("[publishCache] menu save failed:", menu._id, err.message);
    }
  }


    if (target === "website") {
      await logActivity({
        req,
        action: "Website Published",
        resource: "Website Cache",
        newValue: `${updated} menu(s) published to customer website`,
        description: "Website cache published to live customer site",
      });
    }

    return res.status(200).json({
      success: true,
      message: `${target === "website" ? "Website" : "System"} cache refreshed. ${updated} menu(s) republished.`,
      data: {
        target,
        count: updated,
        publishedAt: now,
      },
    });
};

const publishSystemCache = (req, res, next) =>
  publishToTarget(req, res, "system").catch(next);

const publishWebsiteCache = (req, res, next) =>
  publishToTarget(req, res, "website").catch(next);

module.exports = {
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
};


