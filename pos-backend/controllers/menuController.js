const Menu = require("../models/menuModel");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { logActivity } = require("../services/auditService");
const { normalizeCap } = require("../services/modifierGroups");

/**
 * Menu tenancy scope.
 *
 * A takeaway's menus, categories, products, groups and every menu setting
 * belong to that takeaway ALONE. This helper is the single chokepoint every
 * menu read and write goes through, so it is the one place that guarantees it.
 *
 * It used to be an $or -- restaurantId OR createdBy -- to keep single-user
 * legacy installs working. That is a UNION, not a fallback: whoever created
 * menus for two takeaways then saw both sets merged into one. Because every
 * group operation keys off the group NAME across every menu in scope
 * (rename / delete / toggle-active / reorder), renaming "Sauce" in one
 * takeaway renamed it in the other, and a CSV "replace all" could delete the
 * other takeaway's menus outright.
 *
 * createdBy is now only a FALLBACK, for a user with no restaurantId at all --
 * matching tenantScopeFor() in orderController. Staff still reach menus their
 * owner created, because they share the restaurantId.
 *
 * outletId is deliberately NOT part of this scope: menus are store-wide and no
 * menu carries an outletId. Adding the clause would hide every existing menu
 * the moment anyone set a user's outletId.
 */
const menuScopeFor = (user) => {
  if (user?.restaurantId) return { restaurantId: user.restaurantId };
  return { createdBy: user?._id };
};

const { AUDIENCES, projectMenu } = require("../services/menuCache");

const getMenus = async (req, res, next) => {
  try {
    // Sort by explicit sortOrder first (set by the drag-and-drop reorder
    // endpoint) then by createdAt so tenants that never reordered their
    // categories still get a stable, deterministic ordering that matches
    // what the operator saw when they first created the menu.
    const menus = await Menu.find(menuScopeFor(req.user)).sort({ sortOrder: 1, createdAt: 1 });

    // Module 9 §2 — POS (System) reads the System Published snapshot.
    // Manage Menu (Draft) reads live draft items.
    //
    // The snapshot is the ONLY source for source=system. There is no longer a
    // fallback to menu.items when a menu has not been published yet: that
    // fallback is what let a freshly created category appear on the tills
    // before anyone pressed "Update System Cache". A menu with nothing
    // published simply has no items here.
    const isSystemSource = req.query.source === "system" || req.headers["x-pos-source"] === "system";
    const audience = isSystemSource ? AUDIENCES.SYSTEM : AUDIENCES.DRAFT;

    const projected = menus.map((menu) => {
      const obj = projectMenu(menu, audience);
      // Also sort the items array by their sortOrder so drag-reordered
      // products come back in the biller's chosen order (existing
      // reorderItems stamps sortOrder but Menu.find doesn't guarantee
      // subdocument order after a save unless we sort explicitly).
      if (Array.isArray(obj.items) && obj.items.length > 0) {
        obj.items = [...obj.items].sort(
          (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0),
        );
      }
      return obj;
    });

    res.status(200).json({ success: true, data: projected });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/menu/reorder-categories
 *
 * Accepts { menuIds: [id1, id2, ...] } — the desired top-to-bottom order of
 * the tenant's category rows. Stamps `sortOrder` on each match so a
 * subsequent GET /api/menu returns them in that order. Deliberately silent
 * on menus not present in the payload (they keep their existing sortOrder)
 * so a partial payload from a paginated / filtered view can't nuke the
 * ordering of unseen categories.
 */
const reorderMenus = async (req, res, next) => {
  try {
    const { menuIds } = req.body;
    if (!Array.isArray(menuIds)) {
      return next(createHttpError(400, "menuIds array is required!"));
    }
    const scope = menuScopeFor(req.user);
    let updated = 0;
    await Promise.all(
      menuIds.map(async (id, index) => {
        if (!id) return;
        const result = await Menu.updateOne(
          { _id: id, ...scope },
          { $set: { sortOrder: index } },
        );
        if (result && (result.modifiedCount || result.nModified)) updated += 1;
      }),
    );
    res.status(200).json({
      success: true,
      message: `Reordered ${updated} categor${updated === 1 ? "y" : "ies"}.`,
      count: updated,
    });
  } catch (error) {
    next(error);
  }
};


const addCategory = async (req, res, next) => {
  try {
    const { name, description, dispatchType, bgColor, textColor, showOnPos, showOnWebsite } = req.body;
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
      // description and dispatchType were read off the body and then never
      // written, so a category created with either was silently saved without
      // them and the operator had to re-enter them via Edit.
      ...(description !== undefined ? { description: String(description).trim() } : {}),
      ...(dispatchType !== undefined ? { dispatchType } : {}),
      ...(textColor !== undefined ? { textColor } : {}),
      ...(showOnPos !== undefined ? { showOnPos: Boolean(showOnPos) } : {}),
      ...(showOnWebsite !== undefined ? { showOnWebsite: Boolean(showOnWebsite) } : {}),
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Category added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const updateCategory = async (req, res, next) => {
  try {
    const { menuId, name, description, dispatchType, published, bgColor, textColor, showOnPos, showOnWebsite } = req.body;
    if (!menuId || !name) {
      return next(createHttpError(400, "Menu ID and Category name are required!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    const oldName = menu.name;
    const newName = String(name).trim();

    menu.name = newName;
    if (description !== undefined) menu.description = String(description).trim();
    if (dispatchType !== undefined) menu.dispatchType = dispatchType;
    if (published !== undefined) {
      menu.published = Boolean(published);
      menu.isPublished = Boolean(published);
    }
    if (bgColor !== undefined) menu.bgColor = bgColor;
    if (textColor !== undefined) menu.textColor = textColor;
    if (showOnPos !== undefined) menu.showOnPos = Boolean(showOnPos);
    if (showOnWebsite !== undefined) menu.showOnWebsite = Boolean(showOnWebsite);

    // Category-level Display Status and Dispatch Type cascade to every product
    // in the category. Setting a category to delivery-only, or hiding it, and
    // then finding its products still individually flagged otherwise was a
    // reliable way to end up with a catalogue nobody could explain.
    //
    // Only applied when the operator actually changed the field on this
    // request, so an unrelated rename never rewrites every product.
    if (dispatchType !== undefined && Array.isArray(menu.items)) {
      menu.items.forEach((item) => {
        item.dispatchType = {
          collection: dispatchType.collection !== false,
          delivery: dispatchType.delivery !== false,
          table: dispatchType.table !== false,
        };
      });
    }
    if (published !== undefined && Array.isArray(menu.items)) {
      menu.items.forEach((item) => {
        item.isAvailable = Boolean(published);
      });
    }

    // If category name changed, update items
    if (oldName !== newName && Array.isArray(menu.items)) {
      menu.items.forEach((item) => {
        item.category = newName;
      });
    }

    await menu.save();
    res.status(200).json({ success: true, message: "Category updated!", data: menu });
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

const updateSubcategory = async (req, res, next) => {
  try {
    const { menuId, subcategoryId, name, oldName, description, dispatchType, published, bgColor, textColor } = req.body;
    if (!menuId || (!subcategoryId && !oldName)) {
      return next(createHttpError(400, "Category ID and Subcategory ID/name are required!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    menu.subcategories = menu.subcategories || [];
    let subcat = subcategoryId ? menu.subcategories.id(subcategoryId) : null;
    if (!subcat && oldName) {
      subcat = menu.subcategories.find((s) => s.name === oldName);
    }

    const newName = name ? String(name).trim() : (subcat ? subcat.name : oldName);
    const previousName = subcat ? subcat.name : oldName;

    if (subcat) {
      if (name) subcat.name = newName;
      if (description !== undefined) subcat.description = String(description).trim();
      if (dispatchType !== undefined) subcat.dispatchType = dispatchType;
      if (published !== undefined) {
        subcat.published = Boolean(published);
        subcat.isPublished = Boolean(published);
      }
      if (bgColor !== undefined) subcat.bgColor = bgColor;
      if (textColor !== undefined) subcat.textColor = textColor;
    } else {
      menu.subcategories.push({
        name: newName,
        description: String(description || "").trim(),
        dispatchType: dispatchType || { collection: true, delivery: true, table: true },
        published: published !== false,
        isPublished: published !== false,
        bgColor: bgColor || "#0249fd",
        textColor: textColor || "#ffffff",
      });
    }

    // If subcategory name changed, update items matching previousName
    if (previousName && newName && previousName !== newName && Array.isArray(menu.items)) {
      menu.items.forEach((item) => {
        if (item.subcategory === previousName) {
          item.subcategory = newName;
        }
      });
    }

    await menu.save();
    res.status(200).json({ success: true, message: "Subcategory updated!", data: menu });
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
      visibleOnPosWhenOff: Boolean(req.body?.visibleOnPosWhenOff),
      visibleOnWebsiteWhenOff: Boolean(req.body?.visibleOnWebsiteWhenOff),
    });
    await menu.save();
    res.status(201).json({ success: true, message: "Dish added!", data: menu });
  } catch (error) {
    next(error);
  }
};

const updateDish = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    const {
      name,
      price,
      description,
      dispatchType,
      bgColor,
      textColor,
      samePrice,
      channelPrices,
      isVegetarian,
      displayTarget,
      imageUrl,
      isAvailable,
      visibleOnPosWhenOff,
      visibleOnWebsiteWhenOff,
      schedule,
      modifierGroups,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(menuId) || !mongoose.Types.ObjectId.isValid(itemId)) {
      return next(createHttpError(404, "Invalid id!"));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    const item = menu.items.id(itemId);
    if (!item) return next(createHttpError(404, "Dish not found!"));

    if (name !== undefined) item.name = String(name).trim();
    if (price !== undefined) {
      const numPrice = Number(price);
      if (Number.isFinite(numPrice) && numPrice >= 0) item.price = numPrice;
    }
    if (description !== undefined) item.description = String(description).trim();
    if (dispatchType !== undefined) item.dispatchType = dispatchType;
    if (bgColor !== undefined) item.bgColor = bgColor;
    if (textColor !== undefined) item.textColor = textColor;
    if (samePrice !== undefined) item.samePrice = Boolean(samePrice);
    if (channelPrices !== undefined) {
      item.channelPrices = {
        posCollection: Math.max(0, Number(channelPrices?.posCollection || item.price)),
        posDelivery: Math.max(0, Number(channelPrices?.posDelivery || item.price)),
        posTable: Math.max(0, Number(channelPrices?.posTable || item.price)),
        websiteCollection: Math.max(0, Number(channelPrices?.websiteCollection || item.price)),
        websiteDelivery: Math.max(0, Number(channelPrices?.websiteDelivery || item.price)),
        websiteTable: Math.max(0, Number(channelPrices?.websiteTable || item.price)),
      };
    }
    if (isVegetarian !== undefined) item.isVegetarian = Boolean(isVegetarian);
    if (displayTarget !== undefined && ["both", "system", "website"].includes(displayTarget)) {
      item.displayTarget = displayTarget;
    }
    if (imageUrl !== undefined) {
      item.imageUrl = imageUrl;
      item.imageThumbnailUrl = imageUrl;
      item.image = imageUrl;
    }
    if (isAvailable !== undefined) item.isAvailable = Boolean(isAvailable);
    if (visibleOnPosWhenOff !== undefined) item.visibleOnPosWhenOff = Boolean(visibleOnPosWhenOff);
    if (visibleOnWebsiteWhenOff !== undefined) item.visibleOnWebsiteWhenOff = Boolean(visibleOnWebsiteWhenOff);
    if (schedule !== undefined) item.schedule = schedule;
    if (Array.isArray(modifierGroups)) item.modifierGroups = modifierGroups;

    await menu.save();
    res.status(200).json({ success: true, message: "Product updated!", data: menu });
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

    // Normalize the incoming options so we can both create a fresh group
    // AND back-fill an existing (empty) group with the full component
    // list when the operator runs bulk-add against products that were
    // previously attached with `options: []` (the historical bug this
    // endpoint used to produce).
    const hasOptions = Array.isArray(options) && options.length > 0;
    const normalizedOptions = hasOptions
      ? options
          .filter((o) => o && String(o.name || "").trim())
          .map((o) => ({
            name: String(o.name).trim(),
            price: Number.isFinite(Number(o.price)) ? Number(o.price) : 0,
          }))
      : [];

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
              ...normalizeCap(req.body),
              options: normalizedOptions,
            });
            count++;
            modified = true;
          } else if (hasOptions) {
            // Re-hydrate an existing but empty/stale group so bulk-add is
            // idempotent — no more phantom groups with zero components.
            const existingOptsEmpty = !Array.isArray(existing.options) || existing.options.length === 0;
            if (existingOptsEmpty) {
              existing.options = normalizedOptions;
              existing.required = Boolean(required);
              Object.assign(existing, normalizeCap(req.body));
              count++;
              modified = true;
            }
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
    const { groupName, required, maxSelections, maxSelectionEnabled, options, dishIds } = req.body;
    if (!groupName || !String(groupName).trim()) {
      return next(createHttpError(400, "Group Name is required!"));
    }
    if (!Array.isArray(options)) {
      return next(createHttpError(400, "Components options array is required!"));
    }
    // ⚠️ Historically an empty/omitted `dishIds` was treated as "apply to
    // ALL dishes in the tenant". That accidentally attached every newly
    // created group to every existing product — which is never what the
    // biller wants. We now REQUIRE an explicit non-empty list of dish IDs
    // so the operator has to opt in per-product from the "Assign to
    // Products" panel in the Manage Group drawer.
    const normalizedDishIds = Array.isArray(dishIds)
      ? dishIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (normalizedDishIds.length === 0) {
      return next(
        createHttpError(
          400,
          "Select at least one product to attach this group to. Groups are no longer applied to every product by default."
        )
      );
    }

    const validatedOptions = options.map((o) => {
      if (!o.name || !String(o.name).trim()) {
        throw createHttpError(400, "Component name is required!");
      }
      const p = Number(o.price);
      if (!Number.isFinite(p) || p < 0) {
        throw createHttpError(400, `Price for component "${o.name}" must be numeric and cannot be negative!`);
      }
      return { name: String(o.name).trim(), price: p };
    });

    const dishIdSet = new Set(normalizedDishIds);

    const menus = await Menu.find(menuScopeFor(req.user));
    let updatedCount = 0;

    // NOTE: this endpoint is deliberately ADD-ONLY. Removing a group from a
    // product must go through the explicit "Remove Group from Selected"
    // action (bulkRemoveGroupFromDishes) or the "Delete Group" button.
    // Silently detaching every unselected product on every save led to
    // surprises where a badly-refreshed drawer would nuke previously-linked
    // dishes it didn't know about — we don't do that any more.
    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        const itemIdStr = String(item._id);
        if (!dishIdSet.has(itemIdStr)) continue;

        item.modifierGroups = item.modifierGroups || [];
        // A cap only means anything when the operator switched it on; OFF is
        // "as many as you like". The number is kept either way, so turning
        // the cap back on restores the figure instead of resetting it to 1.
        const cap = normalizeCap(req.body);

        const existing = item.modifierGroups.find((g) => g.name === groupName);
        if (existing) {
          existing.required = Boolean(required);
          Object.assign(existing, cap);
          existing.options = validatedOptions;
          // isActive and sortOrder are owned by their own endpoints — saving a
          // group's contents must not silently switch it back on or move it.
        } else {
          item.modifierGroups.push({
            name: groupName,
            required: Boolean(required),
            ...cap,
            options: validatedOptions,
            // Land new groups at the end of the existing order.
            sortOrder: item.modifierGroups.length,
          });
        }
        modified = true;
        updatedCount++;
      }
      if (modified) await menu.save();
    }

    res.status(200).json({
      success: true,
      message: `Group "${groupName}" saved to ${updatedCount} product(s).`,
      count: updatedCount,
    });
  } catch (error) {
    next(error);
  }
};

const deleteGroupFromDishes = async (req, res, next) => {
  try {
    const { groupName } = req.body;
    if (!groupName || !String(groupName).trim()) {
      return next(createHttpError(400, "Group Name is required!"));
    }

    const menus = await Menu.find(menuScopeFor(req.user));
    let count = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (item.modifierGroups && item.modifierGroups.length > 0) {
          const initialLen = item.modifierGroups.length;
          item.modifierGroups = item.modifierGroups.filter((g) => g.name !== groupName.trim());
          if (item.modifierGroups.length < initialLen) {
            count++;
            modified = true;
          }
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group "${groupName}" deleted successfully!`, count });
  } catch (error) {
    next(error);
  }
};

const renameGroupInDishes = async (req, res, next) => {
  try {
    const { oldGroupName, newGroupName } = req.body;
    if (!oldGroupName || !newGroupName || !String(newGroupName).trim()) {
      return next(createHttpError(400, "Old Group Name and New Group Name are required!"));
    }

    const menus = await Menu.find(menuScopeFor(req.user));
    let count = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (item.modifierGroups && item.modifierGroups.length > 0) {
          for (const g of item.modifierGroups) {
            if (g.name === oldGroupName.trim()) {
              g.name = newGroupName.trim();
              modified = true;
              count++;
            }
          }
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group renamed to "${newGroupName.trim()}"!`, count });
  } catch (error) {
    next(error);
  }
};

const toggleGroupActiveInDishes = async (req, res, next) => {
  try {
    const { groupName, isActive } = req.body;
    if (!groupName || !String(groupName).trim()) {
      return next(createHttpError(400, "Group Name is required!"));
    }

    const menus = await Menu.find(menuScopeFor(req.user));
    let count = 0;

    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (item.modifierGroups && item.modifierGroups.length > 0) {
          for (const g of item.modifierGroups) {
            if (g.name === groupName.trim()) {
              g.isActive = Boolean(isActive);
              modified = true;
              count++;
            }
          }
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: `Group "${groupName}" status updated!`, count });
  } catch (error) {
    next(error);
  }
};

const reorderGroupsInDishes = async (req, res, next) => {
  try {
    const { groupOrder } = req.body;
    if (!Array.isArray(groupOrder)) {
      return next(createHttpError(400, "groupOrder array is required!"));
    }

    const orderMap = new Map(groupOrder.map((name, idx) => [String(name).trim(), idx]));

    const menus = await Menu.find(menuScopeFor(req.user));
    for (const menu of menus) {
      let modified = false;
      for (const item of menu.items) {
        if (item.modifierGroups && item.modifierGroups.length > 0) {
          item.modifierGroups.forEach((g) => {
            if (orderMap.has(g.name)) {
              g.sortOrder = orderMap.get(g.name);
              modified = true;
            }
          });
          item.modifierGroups.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        }
      }
      if (modified) await menu.save();
    }

    res.status(200).json({ success: true, message: "Groups reordered successfully!" });
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
      ...normalizeCap(req.body),
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

/**
 * DELETE /api/menu/:menuId/dishes  { itemIds: [...] }
 *
 * Bulk delete, in ONE atomic write.
 *
 * The UI used to loop over the selection and fire a separate deleteDish
 * request per product. Every one of those loaded the SAME Menu document,
 * spliced one item and saved — so the first save bumped the document's `__v`
 * and every other request in flight failed Mongoose's optimistic-concurrency
 * check with a VersionError, surfacing as a 500. The visible result was
 * exactly one product deleted and a server error for the rest.
 *
 * A single `$pull … $in` removes them all without reading the document into
 * memory first, so there is no version to race on and no partial outcome.
 */
const deleteDishes = async (req, res, next) => {
  try {
    const { menuId } = req.params;
    const rawIds = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];

    if (!mongoose.Types.ObjectId.isValid(menuId)) {
      return next(createHttpError(404, "Invalid id!"));
    }
    if (!rawIds.length) {
      return next(createHttpError(400, "Select at least one product to delete."));
    }
    if (rawIds.length > 500) {
      return next(createHttpError(400, "Too many products selected at once."));
    }

    const itemIds = rawIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (!itemIds.length) {
      return next(createHttpError(400, "No valid product ids supplied."));
    }

    const menu = await Menu.findOne({ _id: menuId, ...menuScopeFor(req.user) });
    if (!menu) return next(createHttpError(404, "Category not found!"));

    const before = menu.items.length;

    await Menu.updateOne(
      { _id: menu._id },
      { $pull: { items: { _id: { $in: itemIds.map((id) => new mongoose.Types.ObjectId(String(id))) } } } },
    );

    const updated = await Menu.findById(menu._id);
    const deleted = before - updated.items.length;

    res.status(200).json({
      success: true,
      message: `${deleted} product${deleted === 1 ? "" : "s"} deleted!`,
      data: updated,
      meta: { requested: itemIds.length, deleted },
    });
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
const publishAllMenusForUser = async (user, target) => {
  const now = new Date();
  const timestampField =
    target === "website" ? "lastPublishedToWebsiteAt" : "lastPublishedToSystemAt";

  const menus = await Menu.find({
    ...menuScopeFor(user),
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

  return { updated, now };
};

const publishToTarget = async (req, res, target) => {
  const { updated, now } = await publishAllMenusForUser(req.user, target);

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
  // Exposed for tests: takeaway isolation lives or dies on this helper.
  __menuScopeForTest: menuScopeFor,
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
  deleteDishes,
  reorderItems,
  reorderMenus,
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
  publishAllMenusForUser,
  publishSystemCache,
  publishWebsiteCache,
};


