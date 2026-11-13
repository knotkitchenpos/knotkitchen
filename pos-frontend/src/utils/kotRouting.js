/**
 * Category-wise KOT printer routing (Settings > Device Configuration >
 * Kitchen Printers). Pure functions: no storage, no printing.
 *
 * A kitchen printer's `route`:
 *   { all: true }                                  every dish
 *   { all: false, categories: [catId], excluded: [itemId] }
 *                                                  every dish of those categories
 *                                                  except the excluded ones
 * A category stores its id, not its dishes: a dish added to it later prints
 * there too. The same dish may print on several printers.
 *
 * Dishes no kitchen printer takes print on the receipt printer (or, with none,
 * on the first kitchen printer): a sale is never left without a ticket.
 */

export const ROUTE_ALL = Object.freeze({ all: true, categories: [], excluded: [] });

export const normalizeRoute = (route) => {
  if (!route || route.all !== false) return { ...ROUTE_ALL };
  const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))];
  return { all: false, categories: ids(route.categories), excluded: ids(route.excluded) };
};

/** True when `route` prints dish `itemId` of category `categoryId`. */
export const routeTakes = (route, itemId, categoryId) => {
  const r = normalizeRoute(route);
  if (r.all) return true;
  if (!categoryId || !r.categories.includes(String(categoryId))) return false;
  return !r.excluded.includes(String(itemId));
};

/** A dish name without the variant the till adds: "Margherita (Large)" -> "margherita". */
const baseName = (name) =>
  String(name || "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim()
    .toLowerCase();

/**
 * From a menu (an array of categories with `items`), a function telling an
 * order line's dish and category: by its menuItemId, else by its name.
 */
export const menuIndex = (menus = []) => {
  const byId = new Map();
  const byName = new Map();
  for (const m of Array.isArray(menus) ? menus : []) {
    for (const i of m?.items || []) {
      if (!i) continue;
      const entry = { itemId: String(i._id || ""), categoryId: String(m._id || "") };
      if (i._id) byId.set(String(i._id), entry);
      const key = baseName(i.name);
      if (key && !byName.has(key)) byName.set(key, entry);
    }
  }
  return (line) => {
    const id = line?.menuItemId || line?.itemId || line?.dishId;
    if (id && byId.has(String(id))) return byId.get(String(id));
    const name = line?.originalName || line?.name;
    return byName.get(String(name || "").trim().toLowerCase()) || byName.get(baseName(name)) || null;
  };
};

/**
 * Split a KOT's lines across this device's printers.
 *
 * @param {Array}  lines     the lines to print (already without cancelled ones)
 * @param {Array}  kitchens  kitchen printers that are set up ({ id, label, route, ...printer })
 * @param {object} receipt   the receipt printer (`type` empty when none)
 * @param {function} lookup  menuIndex(...) result
 * @returns {Array<{ id, label, printer, items }>} one ticket per printer that has lines
 */
export const routeKot = ({ lines = [], kitchens = [], receipt = {}, lookup = () => null }) => {
  if (!kitchens.length) return lines.length ? [{ id: "receipt", label: "", printer: receipt, items: lines }] : [];
  const tickets = kitchens.map((k) => ({ id: k.id, label: k.label || "", printer: k, items: [] }));
  const leftover = [];
  for (const line of lines) {
    const hit = lookup(line);
    let taken = false;
    kitchens.forEach((k, i) => {
      if (routeTakes(k.route, hit?.itemId, hit?.categoryId)) {
        tickets[i].items.push(line);
        taken = true;
      }
    });
    if (!taken) leftover.push(line);
  }
  const out = tickets.filter((t) => t.items.length);
  if (leftover.length) {
    if (receipt?.type) out.push({ id: "receipt", label: "Not assigned", printer: receipt, items: leftover });
    else {
      const first = out.find((t) => t.id === kitchens[0].id);
      if (first) first.items.push(...leftover);
      else out.unshift({ id: kitchens[0].id, label: kitchens[0].label || "", printer: kitchens[0], items: leftover });
    }
  }
  return out;
};

/**
 * What a route covers on this menu, for the settings screen:
 * per category, how many of its dishes print here.
 */
export const routeSummary = (route, menus = []) => {
  const r = normalizeRoute(route);
  if (r.all) return { all: true, categories: [] };
  const categories = [];
  for (const m of menus) {
    if (!r.categories.includes(String(m._id))) continue;
    const items = (m.items || []).filter(Boolean);
    const on = items.filter((i) => !r.excluded.includes(String(i._id))).length;
    categories.push({ id: String(m._id), name: m.name, on, total: items.length });
  }
  return { all: false, categories };
};

/** Dishes of `menus` that no printer in `kitchens` takes (they print on the receipt printer). */
export const unassignedItems = (kitchens = [], menus = []) => {
  if (!kitchens.length || kitchens.some((k) => normalizeRoute(k.route).all)) return [];
  const out = [];
  for (const m of menus) {
    for (const i of m.items || []) {
      if (i && !kitchens.some((k) => routeTakes(k.route, i._id, m._id))) out.push({ ...i, categoryName: m.name });
    }
  }
  return out;
};
