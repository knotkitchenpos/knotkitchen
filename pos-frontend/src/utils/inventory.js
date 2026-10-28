/**
 * Inventory units and statuses as the screens show them. The rules
 * themselves live on the server (pos-backend/services/inventory.js): which
 * units convert into which, and what each status means. This mirrors the
 * names, so a dropdown only offers units the server will accept.
 */

export const UNITS = [
  { code: "pcs", label: "Piece", family: "count" },
  { code: "dozen", label: "Dozen", family: "count" },
  { code: "g", label: "Gram", family: "mass" },
  { code: "kg", label: "KG", family: "mass" },
  { code: "ml", label: "ML", family: "volume" },
  { code: "L", label: "Litre", family: "volume" },
  { code: "pack", label: "Pack", family: "pack" },
];

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
