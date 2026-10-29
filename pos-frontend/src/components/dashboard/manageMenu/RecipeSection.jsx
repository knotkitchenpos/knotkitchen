import React, { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getIngredients, getRecipes, getSubscriptionStatus } from "../../../https";
import { unitLabel, unitsLike } from "../../../utils/inventory";

/**
 * The product form's Recipe section: the inventory items one serving uses,
 * each in the unit the cook thinks in (20 Gram of a cheese counted in KG).
 * Every sale of the product then takes them off the shelf
 * (pos-backend/services/inventory.js).
 *
 * The drawer owns the value -- `{ enabled, rows, existed }`, null until it is
 * loaded -- and sends it with the product (menuController#checkRecipe).
 * Loaded once per product opened, so a background refetch never wipes what
 * is being typed. Hidden on a plan without inventory.
 */
const RecipeSection = ({ open, productId, value, onChange }) => {
  const { data: subRes } = useQuery({ queryKey: ["subscription"], queryFn: getSubscriptionStatus, staleTime: 60_000, enabled: open });
  // Only once the plan is known: an inventory call on the Billing plan is refused, and pops "Upgrade to the POS plan".
  const available = Boolean(subRes) && subRes?.data?.data?.features?.pos !== false;
  const { data: ingRes, isSuccess: ingLoaded } = useQuery({ queryKey: ["inventory", "ingredients"], queryFn: getIngredients, enabled: open && available });
  // Fresh on every open: a cached copy from before this product's last save would show the old recipe.
  const { data: recRes, isFetchedAfterMount: recLoaded } = useQuery({
    queryKey: ["inventory", "recipes"], queryFn: getRecipes, enabled: open && available && Boolean(productId), refetchOnMount: "always",
  });
  const ingredients = ingRes?.data?.data || [];
  const unitOf = (id) => ingredients.find((i) => String(i._id) === String(id))?.unit || "";

  const loadedFor = useRef(null);
  const key = open ? productId || "new" : null;
  useEffect(() => {
    if (!key) {
      loadedFor.current = null;
      return;
    }
    if (loadedFor.current === key) return;
    if (productId && !recLoaded) {
      onChange(null); // never the last product's recipe while this one loads
      return;
    }
    loadedFor.current = key;
    const saved = productId ? (recRes?.data?.data || []).find((r) => String(r.menuItemId) === String(productId)) : null;
    onChange({
      enabled: Boolean(saved && saved.isActive !== false && saved.ingredients?.length),
      existed: Boolean(saved),
      rows: saved?.ingredients?.length
        ? saved.ingredients.map((i) => ({ ingredientId: String(i.ingredientId), quantity: String(i.quantity), unit: i.unit }))
        : [{ ingredientId: "", quantity: "", unit: "" }],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, recLoaded]);

  if (!available || !value) return null;
  const setRows = (rows) => onChange({ ...value, rows });
  const setRow = (i, patch) => setRows(value.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <div className="pt-2 border-t border-[#E2E8F0] space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-[13px] font-extrabold text-[#0F172A]">Recipe</label>
          <p className="text-[11.5px] text-[#94A3B8]">Each sale takes these items out of inventory.</p>
        </div>
        <input
          type="checkbox"
          aria-label="Use a recipe"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
          className="w-5 h-5 accent-[#22C55E]"
        />
      </div>

      {value.enabled && (
        ingLoaded && ingredients.length === 0 ? (
          <p className="text-[12px] font-bold text-[#B45309]">Add items in Settings › Inventory Management first.</p>
        ) : (
          <div className="space-y-2 p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
            <p className="text-[11.5px] font-bold text-[#64748B]">One serving uses</p>
            {value.rows.map((r, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <select
                  value={r.ingredientId}
                  onChange={(e) => setRow(i, { ingredientId: e.target.value, unit: unitOf(e.target.value) })}
                  className="flex-1 min-w-0 h-[34px] px-2 rounded-lg border border-[#CBD5E1] bg-white text-[12.5px] font-bold"
                >
                  <option value="">Inventory item…</option>
                  {ingredients.map((ing) => <option key={ing._id} value={ing._id}>{ing.name}</option>)}
                </select>
                <input
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  placeholder="Qty"
                  value={r.quantity}
                  onChange={(e) => setRow(i, { quantity: e.target.value })}
                  className="w-[64px] h-[34px] px-2 rounded-lg border border-[#CBD5E1] text-[12.5px] font-bold"
                />
                <select
                  value={r.unit || unitOf(r.ingredientId)}
                  disabled={!r.ingredientId}
                  onChange={(e) => setRow(i, { unit: e.target.value })}
                  className="w-[76px] h-[34px] px-1 rounded-lg border border-[#CBD5E1] bg-white text-[12px] font-bold"
                  aria-label="Unit"
                >
                  {r.ingredientId ? (
                    unitsLike(unitOf(r.ingredientId)).map((u) => <option key={u.code} value={u.code}>{u.label}</option>)
                  ) : (
                    <option value="">Unit</option>
                  )}
                </select>
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => setRows(value.rows.filter((_, k) => k !== i))}
                  className="text-[#94A3B8] hover:text-[#DC2626] text-[18px] leading-none px-1"
                >
                  &times;
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows([...value.rows, { ingredientId: "", quantity: "", unit: "" }])}
              className="text-[12px] font-bold text-[#C2410C] hover:underline"
            >
              + Add inventory item
            </button>
            {value.rows.some((r) => r.ingredientId && r.unit && r.unit !== unitOf(r.ingredientId)) && (
              <p className="text-[11px] text-[#94A3B8]">
                Converted to each item&apos;s stock unit on sale (for example Gram to {unitLabel("kg")}).
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
};

export default RecipeSection;
