/**
 * Inventory units and statuses as the screens show them. The rules
 * themselves live on the server (pos-backend/services/inventory.js): which
 * units convert into which, and what each status means. This mirrors the
 * names, so a dropdown only offers units the server will accept.
 */

export const UNITS = [
  { code: "pcs", label: "Piece", family: "count", factor: 1 },
  { code: "dozen", label: "Dozen", family: "count", factor: 12 },
  { code: "g", label: "Gram", family: "mass", factor: 1 },
  { code: "kg", label: "KG", family: "mass", factor: 1000 },
  { code: "ml", label: "ML", family: "volume", factor: 1 },
  { code: "L", label: "Litre", family: "volume", factor: 1000 },
  { code: "pack", label: "Pack", family: "pack", factor: 1 },
];

/** `quantity` in `from`, expressed in `to` (as the server converts); null across kinds of measure. */
export const convertQty = (quantity, from, to) => {
  const a = UNITS.find((u) => u.code === from);
  const b = UNITS.find((u) => u.code === to);
  if (!a || !b || a.family !== b.family) return null;
  return Math.round(((Number(quantity) || 0) * a.factor) / b.factor * 1000) / 1000;
};

export const unitLabel = (code) => UNITS.find((u) => u.code === code)?.label || code || "";

/** The units an amount of an item counted in `code` may be entered in: the same kind of measure. */
export const unitsLike = (code) => {
  const family = UNITS.find((u) => u.code === code)?.family;
  return family ? UNITS.filter((u) => u.family === family) : UNITS;
};

export const STATUS = {
  in: { label: "In Stock", className: "bg-[#DCFCE7] text-[#166534]" },
  low: { label: "Low Stock", className: "bg-[#FEF3C7] text-[#92400E]" },
  out: { label: "Out of Stock", className: "bg-[#FEE2E2] text-[#991B1B]" },
  max: { label: "Maximum Stock Reached", className: "bg-[#DBEAFE] text-[#1E40AF]" },
};

export const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/**
 * The items a dish would use up if `add` (a dish and how many more of it) went
 * into this cart: each one whose stock the whole cart needs all of, or more.
 * `stock` is GET /api/inventory/availability. A dish with no recipe uses
 * nothing. With 1 Pizza Dough left, a pizza on 1 dough returns the dough:
 * "Only 1 Pizza Dough in stock. Do you want to continue?"
 */
export const stockShortfalls = (cart = [], add = {}, stock) => {
  const recipes = new Map((stock?.recipes || []).map((r) => [String(r.menuItemId), r]));
  const recipe = recipes.get(String(add.menuItemId || ""));
  if (!recipe) return [];
  const items = new Map((stock.items || []).map((i) => [String(i._id), i]));
  const need = new Map();
  for (const line of [...(Array.isArray(cart) ? cart : []), add]) {
    const r = recipes.get(String(line?.menuItemId || ""));
    if (!r) continue;
    const servings = Number(line.quantity) || 0;
    for (const l of r.ingredients || []) {
      const item = items.get(String(l.ingredientId));
      const amount = item && convertQty((Number(l.quantity) || 0) * servings / Math.max(1, Number(r.yield) || 1), l.unit || item.unit, item.unit);
      if (amount) need.set(item._id, (need.get(item._id) || 0) + amount);
    }
  }
  const used = [...new Set((recipe.ingredients || []).map((l) => String(l.ingredientId)))];
  return used
    .map((id) => items.get(id))
    .filter((item) => item && (need.get(item._id) || 0) >= (Number(item.stockQuantity) || 0) - 1e-9)
    .map((item) => ({ ingredientId: item._id, name: item.name, unit: item.unit, stockQuantity: Math.max(0, Number(item.stockQuantity) || 0) }));
};

/** "Only 1 Pizza Dough in stock." / "Only 0.02 KG Mozzarella Cheese in stock." / "Flour is out of stock." */
export const shortfallText = (item) =>
  item.stockQuantity > 0
    ? `Only ${qty(item.stockQuantity)}${item.unit === "pcs" ? "" : ` ${unitLabel(item.unit)}`} ${item.name} in stock.`
    : `${item.name} is out of stock.`;

/**
 * The product form's Recipe section as Manage Menu sends it: only when a
 * recipe is on, or was saved before (so switching it off reaches the server).
 * Absent, the server leaves the product's recipe as it is.
 */
export const recipeForSave = (recipe) =>
  recipe && (recipe.enabled || recipe.existed)
    ? {
        enabled: recipe.enabled,
        ingredients: recipe.rows
          .filter((r) => r.ingredientId && Number(r.quantity) > 0)
          .map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity), unit: r.unit })),
      }
    : undefined;

/**
 * What recipe lines cost at the items' cost prices, as the server works it out
 * (services/inventory.js linesCost): each line converted to its item's unit.
 * Items with no cost price are named in `missing`.
 */
export const linesCost = (lines = [], ingredients = []) => {
  const byId = new Map(ingredients.map((i) => [String(i._id), i]));
  let cost = 0;
  const missing = [];
  for (const l of lines || []) {
    const ing = byId.get(String(l.ingredientId));
    if (!ing || !(Number(l.quantity) > 0)) continue;
    const q = convertQty(l.quantity, l.unit || ing.unit, ing.unit);
    if (q === null) continue;
    if (!(Number(ing.costPerUnit) > 0)) missing.push(ing.name);
    else cost += q * Number(ing.costPerUnit);
  }
  return { cost: Math.round(cost * 100) / 100, missing };
};

export const rupees = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 })}`;

/** Food cost % colour: within target green, up to 10 points over amber, beyond red. */
export const foodCostTone = (pct, target = 35) =>
  pct === null || pct === undefined ? "text-[#94A3B8]" : pct <= target ? "text-[#15803D]" : pct <= target + 10 ? "text-[#B45309]" : "text-[#B91C1C]";
