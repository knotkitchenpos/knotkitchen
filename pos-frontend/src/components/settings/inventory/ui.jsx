import React from "react";
import { linesCost, rupees, unitsLike } from "../../../utils/inventory";

/** Shared look of the Inventory Management screens (components/settings/InventoryView.jsx). */
export const inputClass = "h-[40px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]";
/** A small fixed-width box (a count, a pack size): the field style without w-full, which would win over w-[..]. */
export const boxClass = inputClass.replace(" w-full", " shrink-0");
export const labelClass = "block text-[11.5px] font-bold text-[#64748B] mb-1";
export const btnPrimary = "h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
export const btnGhost = "h-[36px] px-3 rounded-xl border border-[#E2E8F0] text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";
export const card = "bg-white border border-[#E2E8F0] rounded-2xl";

export const Modal = ({ title, onClose, children, wide = false }) => (
  <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
    <div
      className={`w-full ${wide ? "sm:max-w-xl" : "sm:max-w-md"} max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl space-y-3`}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="text-[15px] font-extrabold text-[#0F172A]">{title}</h3>
      {children}
    </div>
  </div>
);

export const EMPTY_LINE = { ingredientId: "", quantity: "", unit: "" };

/** Recipe lines as the server takes them: picked items with a quantity. */
export const cleanLines = (rows, ingredients) =>
  rows
    .filter((r) => r.ingredientId && Number(r.quantity) > 0)
    .map((r) => ({
      ingredientId: r.ingredientId,
      quantity: Number(r.quantity),
      unit: r.unit || ingredients.find((i) => i._id === r.ingredientId)?.unit || "",
    }));

/** Saved recipe lines as the editor holds them. */
export const toRows = (lines = [], ingredients = []) =>
  lines.length
    ? lines.map((l) => ({
        ingredientId: String(l.ingredientId),
        quantity: String(l.quantity),
        unit: l.unit || ingredients.find((i) => String(i._id) === String(l.ingredientId))?.unit || "",
      }))
    : [{ ...EMPTY_LINE }];

/**
 * "Uses these items": a list of inventory items with a quantity and unit
 * each, and what they cost together at today's cost prices. Used by dish
 * recipes, add-ons and sizes, and prepared items' batch recipes.
 * `exclude` leaves an item out of the picker (a prepared item cannot use itself).
 */
export const LinesEditor = ({ ingredients, rows, setRows, exclude, divideBy = 1, costLabel = "Cost" }) => {
  const unitOf = (id) => ingredients.find((i) => i._id === id)?.unit || "";
  const setRow = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const { cost, missing } = linesCost(cleanLines(rows, ingredients), ingredients);
  const options = ingredients.filter((i) => i._id !== exclude);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        // Phones: the item on its own line, quantity and unit below it.
        <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 pb-2 sm:pb-0 border-b border-[#F1F5F9] sm:border-0">
          <select
            className={`${inputClass} basis-full sm:basis-auto sm:flex-1`}
            value={r.ingredientId}
            onChange={(e) => setRow(i, { ingredientId: e.target.value, unit: unitOf(e.target.value) })}
          >
            <option value="">Item…</option>
            {options.map((ing) => (
              <option key={ing._id} value={ing._id}>
                {ing.name}
                {ing.isPrepared ? " (prepared)" : ""}
              </option>
            ))}
          </select>
          <input
            className={`${inputClass} flex-1 min-w-0 sm:flex-none sm:w-[90px]`}
            type="number" min="0" step="any" inputMode="decimal" placeholder="Qty"
            value={r.quantity}
            onChange={(e) => setRow(i, { quantity: e.target.value })}
          />
          <select
            className={`${inputClass} flex-1 min-w-0 sm:flex-none sm:w-[96px]`}
            value={r.unit || unitOf(r.ingredientId)}
            disabled={!r.ingredientId}
            onChange={(e) => setRow(i, { unit: e.target.value })}
            aria-label="Unit"
          >
            {unitsLike(unitOf(r.ingredientId)).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
          <button
            type="button" aria-label="Remove"
            className="w-8 h-[40px] shrink-0 text-[18px] text-[#94A3B8] hover:text-[#DC2626]"
            onClick={() => setRows(rows.length > 1 ? rows.filter((_, k) => k !== i) : [{ ...EMPTY_LINE }])}
          >
            &times;
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-[12.5px] font-bold text-[#C2410C] hover:underline" onClick={() => setRows([...rows, { ...EMPTY_LINE }])}>
          + Add item
        </button>
        {cost > 0 && (
          <span className="text-[12.5px] font-bold text-[#334155]">
            {costLabel}: {rupees(cost / Math.max(1, Number(divideBy) || 1))}
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <p className="text-[11.5px] text-[#B45309]">No cost price yet for {missing.join(", ")}: the cost leaves them out.</p>
      )}
    </div>
  );
};
