/**
 * Menu across stores, for the Partners dashboard (owner, 2026-11-13): copy
 * categories from one store to others, and change a dish's price in several
 * stores at once. Both change the stores' DRAFT menus, exactly as Manage
 * Menu does; what the tills and website serve changes when the store is
 * published (Manage Menu > Publish, or "Publish now" on the same page).
 *
 * Copy is a merge, never a replace: a category the target already has (same
 * name) gets the dishes it lacks (by name); one it lacks is created. Nothing
 * in the target is changed or removed. A copied dish keeps its photo (by
 * URL) but not the source store's media-library link, nor any "switched off
 * because stock ran out" mark, which belonged to the source's inventory.
 */
const getMenu = () => require("../models/menuModel");

const key = (s) => String(s || "").trim().toLowerCase();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** A plain copy of a dish with every _id dropped, so the target gets fresh ones. */
const stripIds = (value) => {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "_id" || k === "id" || k === "__v") continue;
      out[k] = stripIds(v);
    }
    return out;
  }
  return value;
};

const copyableItem = (item, categoryName) => {
  const plain = stripIds(typeof item.toObject === "function" ? item.toObject() : item);
  delete plain.imageId;
  delete plain.stockOffBy;
  plain.category = categoryName;
  return plain;
};

const draftScope = (owner) => ({ restaurantId: owner.restaurantId, isDeleted: { $ne: true } });

/** One store's draft menu, compact: categories with their dishes and prices. */
const catalogOf = async (owner) => {
  const menus = await getMenu().find(draftScope(owner)).select("name sortOrder items._id items.name items.price items.variants items.samePrice items.isAvailable").sort({ sortOrder: 1, createdAt: 1 }).lean();
  return menus.map((m) => ({
    id: String(m._id),
    name: m.name,
    items: (m.items || []).map((i) => ({
      id: String(i._id),
      name: i.name,
      price: i.price,
      samePrice: i.samePrice !== false,
      variants: (i.variants || []).map((v) => ({ id: String(v._id), name: v.name, price: v.price })),
    })),
  }));
};

/**
 * Copy `categoryIds` of `source` into `target`'s draft menu.
 * @returns {{ categoriesCreated, dishesAdded, dishesSkipped }}
 */
const copyCategories = async ({ source, target, categoryIds }) => {
  const Menu = getMenu();
  const wanted = new Set((categoryIds || []).map(String));
  const from = (await Menu.find(draftScope(source)).sort({ sortOrder: 1, createdAt: 1 })).filter((m) => wanted.has(String(m._id)));
  const existing = await Menu.find(draftScope(target)).sort({ sortOrder: 1 });
  let nextSort = existing.reduce((m, x) => Math.max(m, Number(x.sortOrder) || 0), 0);
  const result = { categoriesCreated: 0, dishesAdded: 0, dishesSkipped: 0 };
  for (const cat of from) {
    const there = existing.find((m) => key(m.name) === key(cat.name));
    if (there) {
      const have = new Set((there.items || []).map((i) => key(i.name)));
      let added = 0;
      for (const item of cat.items || []) {
        if (have.has(key(item.name))) {
          result.dishesSkipped += 1;
          continue;
        }
        there.items.push(copyableItem(item, there.name));
        have.add(key(item.name));
        added += 1;
      }
      // Subcategories the copied dishes use, if the target lacks them.
      const subs = new Set((there.subcategories || []).map((s) => key(s.name)));
      for (const s of cat.subcategories || []) if (!subs.has(key(s.name))) there.subcategories.push(stripIds(s.toObject ? s.toObject() : s));
      if (added) {
        await there.save();
        result.dishesAdded += added;
      }
      continue;
    }
    nextSort += 1;
    const plain = cat.toObject();
    await Menu.create({
      name: cat.name,
      description: cat.description || "",
      dispatchType: stripIds(plain.dispatchType),
      bgColor: cat.bgColor,
      icon: cat.icon,
      schedule: stripIds(plain.schedule),
      subcategories: stripIds(plain.subcategories || []),
      items: (cat.items || []).map((i) => copyableItem(i, cat.name)),
      published: cat.published !== false,
      showOnPos: Boolean(cat.showOnPos),
      showOnWebsite: Boolean(cat.showOnWebsite),
      sortOrder: nextSort,
      createdBy: target._id,
      restaurantId: target.restaurantId,
      ...(target.outletId ? { outletId: target.outletId } : {}),
    });
    result.categoriesCreated += 1;
    result.dishesAdded += (cat.items || []).length;
  }
  return result;
};

/**
 * Set prices on one store's draft dishes.
 * @param {Array<{ menuId, itemId, price?, variants?: Array<{ id, price }> }>} changes
 * @returns {number} dishes changed
 */
const setPrices = async ({ owner, changes }) => {
  const Menu = getMenu();
  let changed = 0;
  const byMenu = new Map();
  for (const c of changes || []) {
    const list = byMenu.get(String(c.menuId)) || [];
    list.push(c);
    byMenu.set(String(c.menuId), list);
  }
  for (const [menuId, list] of byMenu) {
    const menu = await Menu.findOne({ _id: menuId, ...draftScope(owner) });
    if (!menu) continue;
    let touched = false;
    for (const c of list) {
      const item = menu.items.id(c.itemId);
      if (!item) continue;
      let itemChanged = false;
      if (c.price != null && c.price !== "" && Number.isFinite(Number(c.price)) && Number(c.price) >= 0) {
        item.price = round2(c.price);
        itemChanged = true;
      }
      for (const v of c.variants || []) {
        const variant = (item.variants || []).find((x) => String(x._id) === String(v.id));
        if (variant && v.price !== "" && v.price != null && Number.isFinite(Number(v.price)) && Number(v.price) >= 0) {
          variant.price = round2(v.price);
          itemChanged = true;
        }
      }
      if (itemChanged) {
        changed += 1;
        touched = true;
      }
    }
    if (touched) {
      menu.markModified("items");
      await menu.save();
    }
  }
  return changed;
};

module.exports = { catalogOf, copyCategories, setPrices, stripIds, copyableItem };
