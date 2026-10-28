/**
 * Products switched off, and back on, because an inventory item ran out.
 *
 * When a sale empties an item (Pizza Dough), the POS asks whether to turn off
 * every product whose recipe uses it. Those products are marked sold out the
 * way the till's own switch does it (menuController.toggleDishAvailability:
 * live at once on the tills, QR, website and Knot Eats, no Publish), and each
 * remembers which items turned it off (`stockOffBy`). When the items are back
 * in stock, the POS asks whether to turn those products on again.
 *
 * A product switched off by hand has no `stockOffBy`, so it is never switched
 * on by this; switching it by hand clears the mark (toggleDishAvailability).
 */
const mongoose = require("mongoose");

const ids = (list) => (list || []).map(String);

/** The products (draft item ids) whose active recipe uses any of these items. */
const dishIdsUsing = async (restaurantId, ingredientIds) => {
  const { Recipe } = require("../models/inventoryModel");
  const recipes = await Recipe.find({
    restaurantId,
    isActive: { $ne: false },
    isDeleted: { $ne: true },
    "ingredients.ingredientId": { $in: ingredientIds },
  }).select("menuItemId").lean();
  return recipes.map((r) => r.menuItemId).filter(Boolean);
};

const menusWith = (restaurantId, itemIds) => {
  const Menu = require("../models/menuModel");
  return Menu.find({ restaurantId, isDeleted: { $ne: true }, "items._id": { $in: itemIds } });
};

/** The published copies follow the switch, as they do for the till's own toggle. */
const mirror = (menu, item) => {
  for (const path of ["systemSnapshot", "websiteSnapshot"]) {
    const copy = menu[path]?.items?.id?.(item._id);
    if (!copy) continue;
    copy.isAvailable = item.isAvailable;
    menu.markModified(path);
  }
};

/** Every till, the QR sheet and Knot Eats pick the change up at once. */
const announce = (restaurantId, count) => {
  try {
    require("./knotEats").invalidateListing();
  } catch (err) {
    console.warn("[knot-eats] listing invalidation failed:", err.message);
  }
  try {
    require("./socket").emitToRestaurant(String(restaurantId), "menu:updated", { target: "system", count, publishedAt: new Date() });
  } catch {
    /* no socket in this process: the tills refresh on their next load */
  }
};

/** How many products using this item are still on sale (what the out-of-stock question offers to turn off). */
const countOnSale = async (restaurantId, ingredientId) => {
  const dishIds = ids(await dishIdsUsing(restaurantId, [ingredientId]));
  if (!dishIds.length) return 0;
  const menus = await menusWith(restaurantId, dishIds).select("items._id items.isAvailable").lean();
  const wanted = new Set(dishIds);
  return menus.flatMap((m) => m.items || []).filter((i) => wanted.has(String(i._id)) && i.isAvailable !== false).length;
};

/**
 * Turn off every product that uses this item. One already off because of
 * another item adds this one to its reasons; one switched off by hand is left
 * alone (it was not on sale, and must not come back on with the stock).
 * @returns {Promise<string[]>} the names of the products turned off
 */
const turnOffFor = async (restaurantId, ingredientId) => {
  const dishIds = await dishIdsUsing(restaurantId, [ingredientId]);
  const wanted = new Set(ids(dishIds));
  const id = new mongoose.Types.ObjectId(String(ingredientId));
  const names = [];
  for (const menu of await menusWith(restaurantId, dishIds)) {
    let changed = false;
    for (const item of menu.items) {
      if (!wanted.has(String(item._id))) continue;
      const by = ids(item.stockOffBy);
      if (item.isAvailable !== false) {
        item.isAvailable = false;
        item.stockOffBy = [id];
        names.push(item.name);
        mirror(menu, item);
      } else if (by.length && !by.includes(String(id))) {
        item.stockOffBy = [...item.stockOffBy, id];
      } else {
        continue;
      }
      changed = true;
    }
    if (changed) await menu.save();
  }
  if (names.length) announce(restaurantId, names.length);
  return names;
};

/**
 * The products turned off for want of stock whose items are ALL back now
 * (more than nothing on the shelf; an item since deleted no longer holds
 * one back), and the names of those items.
 */
const backInStock = async (restaurantId) => {
  const Menu = require("../models/menuModel");
  const { Ingredient } = require("../models/inventoryModel");
  const menus = await Menu.find({ restaurantId, isDeleted: { $ne: true }, "items.stockOffBy.0": { $exists: true } })
    .select("items._id items.name items.stockOffBy").lean();
  const offItems = menus.flatMap((m) => (m.items || []).filter((i) => i.stockOffBy?.length));
  if (!offItems.length) return { products: [], ingredients: [] };
  const shelf = await Ingredient.find({ _id: { $in: offItems.flatMap((i) => i.stockOffBy) }, restaurantId })
    .select("_id name stockQuantity isDeleted").lean();
  const byId = new Map(shelf.map((s) => [String(s._id), s]));
  const stocked = (id) => {
    const s = byId.get(String(id));
    return !s || s.isDeleted || (Number(s.stockQuantity) || 0) > 0;
  };
  const ready = offItems.filter((i) => i.stockOffBy.every(stocked));
  const ingredients = [...new Set(ready.flatMap((i) => ids(i.stockOffBy)))]
    .map((id) => byId.get(id))
    .filter((s) => s && !s.isDeleted)
    .map((s) => s.name);
  return { products: ready.map((i) => ({ itemId: String(i._id), name: i.name })), ingredients };
};

/**
 * The owner's answer to "items are back in stock": turn the products on
 * (`turnOn`), or leave them off, from now on as if switched off by hand.
 * Either way they stop waiting for the stock. @returns {Promise<number>}
 */
const answerBackInStock = async (restaurantId, turnOn) => {
  const { products } = await backInStock(restaurantId);
  if (!products.length) return 0;
  const wanted = new Set(products.map((p) => p.itemId));
  let count = 0;
  for (const menu of await menusWith(restaurantId, [...wanted])) {
    let changed = false;
    for (const item of menu.items) {
      if (!wanted.has(String(item._id))) continue;
      item.stockOffBy = undefined;
      if (turnOn) {
        item.isAvailable = true;
        mirror(menu, item);
        count += 1;
      }
      changed = true;
    }
    if (changed) await menu.save();
  }
  if (count) announce(restaurantId, count);
  return count;
};

module.exports = { dishIdsUsing, countOnSale, turnOffFor, backInStock, answerBackInStock };
