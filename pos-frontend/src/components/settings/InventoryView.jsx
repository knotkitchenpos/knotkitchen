import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "notistack";
import {
  createIngredient,
  deleteIngredient,
  deleteRecipe,
  getIngredients,
  getMenus,
  getRecipes,
  getStockMovements,
  recordStockMovement,
  updateIngredient,
  upsertRecipe,
} from "../../https";
import { dateTimeIN as when } from "../../utils";

/**
 * Settings > Inventory.
 *
 * Stock: the ingredients on the shelf, with a reorder level. Receive a
 * purchase, record wastage, or correct the count.
 * Recipes: what each dish on the menu uses. Every sale then takes that off
 * the shelf on its own (pos-backend/services/inventory.js).
 * Log: every movement, newest first.
 */

const UNITS = ["kg", "g", "L", "ml", "pcs", "pack", "dozen"];
const CATEGORIES = [
  ["produce", "Produce"], ["meat", "Meat"], ["seafood", "Seafood"], ["dairy", "Dairy"],
  ["dry_goods", "Dry goods"], ["beverage", "Beverage"], ["other", "Other"],
];
const TABS = [["stock", "Stock"], ["recipes", "Recipes"], ["log", "Log"]];

const inputClass = "h-[40px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]";
const btnPrimary = "h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
const btnGhost = "h-[36px] px-3 rounded-xl border border-[#E2E8F0] text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";
const qty = (n) => Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/* ------------------------------------------------------------------ stock */

const StockTab = ({ ingredients, refresh }) => {
  const [form, setForm] = useState({ name: "", unit: "kg", category: "other", stockQuantity: "", reorderLevel: "", costPerUnit: "" });
  const [move, setMove] = useState(null); // { ingredient, type }
  const [moveQty, setMoveQty] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [editing, setEditing] = useState(null); // ingredient being edited

  const createMut = useMutation({
    mutationFn: createIngredient,
    onSuccess: () => {
      enqueueSnackbar("Ingredient added", { variant: "success" });
      setForm({ name: "", unit: "kg", category: "other", stockQuantity: "", reorderLevel: "", costPerUnit: "" });
      refresh();
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not add", { variant: "error" }),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, ...d }) => updateIngredient(id, d),
    onSuccess: () => { enqueueSnackbar("Saved", { variant: "success" }); setEditing(null); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" }),
  });
  const deleteMut = useMutation({
    mutationFn: deleteIngredient,
    onSuccess: () => { enqueueSnackbar("Removed", { variant: "success" }); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not remove", { variant: "error" }),
  });
  const moveMut = useMutation({
    mutationFn: recordStockMovement,
    onSuccess: () => { enqueueSnackbar("Stock updated", { variant: "success" }); setMove(null); setMoveQty(""); setMoveReason(""); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not update stock", { variant: "error" }),
  });

  const low = ingredients.filter((i) => i.isLowStock);

  return (
    <div className="space-y-4">
      {low.length > 0 && (
        <div className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-[12.5px] text-[#9A3412]">
          <span className="font-bold">Low stock:</span> {low.map((i) => `${i.name} (${qty(i.stockQuantity)} ${i.unit})`).join(", ")}
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4">
        <p className="text-[13px] font-extrabold text-[#0F172A] mb-2">Add an ingredient</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input className={`${inputClass} md:col-span-2`} placeholder="Name (e.g. Paneer)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className={inputClass} type="number" min="0" placeholder="In stock" value={form.stockQuantity} onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })} />
          <input className={inputClass} type="number" min="0" placeholder="Reorder at" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input className={`${inputClass} max-w-[180px]`} type="number" min="0" placeholder="Cost per unit ₹" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: e.target.value })} />
          <button type="button" className={btnPrimary} disabled={!form.name.trim() || createMut.isPending} onClick={() => createMut.mutate({ ...form, stockQuantity: Number(form.stockQuantity) || 0, reorderLevel: Number(form.reorderLevel) || 0, costPerUnit: Number(form.costPerUnit) || 0 })}>
            Add
          </button>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        {ingredients.length === 0 ? (
          <p className="p-6 text-center text-[13px] text-[#94A3B8]">No ingredients yet. Add what you buy: paneer, oil, rice…</p>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
              <tr>
                <th className="px-3 py-2 text-left">Ingredient</th>
                <th className="px-3 py-2 text-right">In stock</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">Reorder at</th>
                <th className="px-3 py-2 text-right hidden sm:table-cell">Cost/unit</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {ingredients.map((i) => (
                <tr key={i._id} className={i.isLowStock ? "bg-[#FFF7ED]" : ""}>
                  <td className="px-3 py-2">
                    <span className="font-bold text-[#0F172A]">{i.name}</span>
                    <span className="block text-[11px] text-[#94A3B8]">{CATEGORIES.find(([k]) => k === i.category)?.[1] || i.category}</span>
                  </td>
                  <td className={`px-3 py-2 text-right font-extrabold tabular-nums ${i.isLowStock ? "text-[#C2410C]" : "text-[#0F172A]"}`}>{qty(i.stockQuantity)} {i.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">{qty(i.reorderLevel)} {i.unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">₹{qty(i.costPerUnit)}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <button type="button" className={btnGhost} onClick={() => setMove({ ingredient: i, type: "purchase" })}>+ Receive</button>
                      <button type="button" className={btnGhost} onClick={() => setMove({ ingredient: i, type: "waste" })}>Waste</button>
                      <button type="button" className={btnGhost} onClick={() => setMove({ ingredient: i, type: "adjustment" })}>Count</button>
                      <button type="button" className={btnGhost} onClick={() => setEditing({ ...i })}>Edit</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {move && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setMove(null)}>
          <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-extrabold text-[#0F172A]">
              {move.type === "purchase" ? "Receive" : move.type === "waste" ? "Wastage" : "Correct the count"} · {move.ingredient.name}
            </h3>
            <p className="text-[12px] text-[#64748B] mt-0.5">Now {qty(move.ingredient.stockQuantity)} {move.ingredient.unit}.</p>
            <input autoFocus className={`${inputClass} mt-3`} type="number" min="0" step="any" inputMode="decimal" value={moveQty} onChange={(e) => setMoveQty(e.target.value)}
              placeholder={move.type === "adjustment" ? `Actual count in ${move.ingredient.unit}` : `Quantity in ${move.ingredient.unit}`} />
            <input className={`${inputClass} mt-2 font-medium`} value={moveReason} onChange={(e) => setMoveReason(e.target.value)} maxLength={200}
              placeholder={move.type === "waste" ? "Reason (spoiled, spilled, expired…)" : "Note (optional)"} />
            <div className="mt-4 flex gap-2">
              <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={() => setMove(null)}>Back</button>
              <button type="button" className={`${btnPrimary} flex-1`} disabled={moveQty === "" || moveMut.isPending || (move.type === "waste" && !moveReason.trim())}
                onClick={() => moveMut.mutate({ ingredientId: move.ingredient._id, type: move.type, quantity: Number(moveQty), reason: moveReason })}>
                {moveMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setEditing(null)}>
          <div className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl space-y-2" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-extrabold text-[#0F172A]">Edit ingredient</h3>
            <input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inputClass} value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
              <select className={inputClass} value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <input className={inputClass} type="number" min="0" value={editing.reorderLevel} onChange={(e) => setEditing({ ...editing, reorderLevel: e.target.value })} placeholder="Reorder at" />
              <input className={inputClass} type="number" min="0" value={editing.costPerUnit} onChange={(e) => setEditing({ ...editing, costPerUnit: e.target.value })} placeholder="Cost per unit" />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" className={`${btnGhost} h-[40px]`} onClick={() => { if (window.confirm(`Remove ${editing.name}?`)) deleteMut.mutate(editing._id); setEditing(null); }}>Remove</button>
              <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={() => setEditing(null)}>Back</button>
              <button type="button" className={`${btnPrimary} flex-1`} disabled={updateMut.isPending}
                onClick={() => updateMut.mutate({ id: editing._id, name: editing.name, unit: editing.unit, category: editing.category, reorderLevel: Number(editing.reorderLevel) || 0, costPerUnit: Number(editing.costPerUnit) || 0 })}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------------------------------------------------------------- recipes */

const RecipesTab = ({ ingredients, refresh }) => {
  const { data: menusRes } = useQuery({ queryKey: ["menus", "draft-for-recipes"], queryFn: () => getMenus() });
  const { data: recipesRes } = useQuery({ queryKey: ["inventory", "recipes"], queryFn: getRecipes });
  const dishes = useMemo(() => {
    const menus = menusRes?.data?.data || [];
    return (Array.isArray(menus) ? menus : []).flatMap((m) => (m.items || []).map((it) => ({ id: String(it._id), name: it.name, category: m.name })));
  }, [menusRes]);
  const recipes = recipesRes?.data?.data || [];
  const byDish = useMemo(() => new Map(recipes.map((r) => [String(r.menuItemId), r])), [recipes]);

  const [dishId, setDishId] = useState("");
  const [rows, setRows] = useState([]); // [{ingredientId, quantity}]
  const [yieldN, setYieldN] = useState(1);
  const [search, setSearch] = useState("");

  const pick = (id) => {
    setDishId(id);
    const r = byDish.get(id);
    setRows(r ? r.ingredients.map((i) => ({ ingredientId: String(i.ingredientId), quantity: String(i.quantity) })) : [{ ingredientId: "", quantity: "" }]);
    setYieldN(r?.yield || 1);
  };
  const saveMut = useMutation({
    mutationFn: () => {
      const dish = dishes.find((d) => d.id === dishId);
      return upsertRecipe(dishId, { menuItemName: dish?.name, yield: Number(yieldN) || 1, ingredients: rows.filter((r) => r.ingredientId && Number(r.quantity) > 0).map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity) })) });
    },
    onSuccess: () => { enqueueSnackbar("Recipe saved", { variant: "success" }); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save the recipe", { variant: "error" }),
  });
  const delMut = useMutation({
    mutationFn: () => deleteRecipe(dishId),
    onSuccess: () => { enqueueSnackbar("Recipe removed", { variant: "success" }); setRows([{ ingredientId: "", quantity: "" }]); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not remove", { variant: "error" }),
  });
  const unitOf = (id) => ingredients.find((i) => i._id === id)?.unit || "";
  const filtered = dishes.filter((d) => `${d.name} ${d.category}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 300);

  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div className="md:col-span-2 bg-white border border-[#E2E8F0] rounded-2xl p-3">
        <input className={`${inputClass} mb-2 font-medium`} placeholder="Search dishes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[420px] overflow-y-auto divide-y divide-[#F1F5F9]">
          {filtered.map((d) => (
            <button key={d.id} type="button" onClick={() => pick(d.id)} className={`w-full text-left px-2 py-2 hover:bg-[#F8FAFC] ${dishId === d.id ? "bg-[#FFF1E8]" : ""}`}>
              <span className="block text-[13px] font-bold text-[#0F172A]">{d.name}</span>
              <span className="block text-[11px] text-[#94A3B8]">
                {d.category}{byDish.has(d.id) ? ` · ${byDish.get(d.id).ingredients.length} ingredient(s)` : " · no recipe"}
              </span>
            </button>
          ))}
          {filtered.length === 0 && <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">No dishes.</p>}
        </div>
      </div>
      <div className="md:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-4">
        {!dishId ? (
          <p className="text-[13px] text-[#94A3B8]">Pick a dish to set what one serving uses.</p>
        ) : ingredients.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">Add ingredients under Stock first.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] font-extrabold text-[#0F172A]">{dishes.find((d) => d.id === dishId)?.name}</p>
            <label className="flex items-center gap-2 text-[12.5px] text-[#475569]">
              This recipe makes
              <input className={`${inputClass} w-[80px]`} type="number" min="1" value={yieldN} onChange={(e) => setYieldN(e.target.value)} />
              serving(s)
            </label>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={inputClass} value={r.ingredientId} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, ingredientId: e.target.value } : x)))}>
                  <option value="">Ingredient…</option>
                  {ingredients.map((ing) => <option key={ing._id} value={ing._id}>{ing.name}</option>)}
                </select>
                <input className={`${inputClass} w-[110px]`} type="number" min="0" step="any" inputMode="decimal" placeholder="Qty" value={r.quantity} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} />
                <span className="w-[40px] text-[12px] text-[#64748B]">{unitOf(r.ingredientId)}</span>
                <button type="button" aria-label="Remove" className="text-[#94A3B8] hover:text-[#DC2626]" onClick={() => setRows(rows.filter((_, k) => k !== i))}>&times;</button>
              </div>
            ))}
            <button type="button" className="text-[12.5px] font-bold text-[#C2410C] hover:underline" onClick={() => setRows([...rows, { ingredientId: "", quantity: "" }])}>+ Add ingredient</button>
            <div className="flex gap-2 pt-2">
              {byDish.has(dishId) && <button type="button" className={`${btnGhost} h-[40px]`} onClick={() => delMut.mutate()}>Remove recipe</button>}
              <button type="button" className={btnPrimary} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>{saveMut.isPending ? "Saving…" : "Save recipe"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- log */

const TYPE_LABEL = { purchase: "Received", sale: "Sold", waste: "Wastage", adjustment: "Count", transfer: "Transfer" };

const LogTab = () => {
  const { data } = useQuery({ queryKey: ["inventory", "movements"], queryFn: () => getStockMovements({ limit: 200 }) });
  const rows = data?.data?.data || [];
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-[#94A3B8]">Nothing has moved yet.</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Ingredient</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-left hidden sm:table-cell">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {rows.map((m) => (
              <tr key={m._id}>
                <td className="px-3 py-2 text-[#64748B] whitespace-nowrap">{when(m.createdAt)}</td>
                <td className="px-3 py-2 font-bold text-[#0F172A]">{m.ingredientName}</td>
                <td className="px-3 py-2">{TYPE_LABEL[m.type] || m.type}</td>
                <td className={`px-3 py-2 text-right font-bold tabular-nums ${m.quantity < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>{m.quantity > 0 ? "+" : ""}{qty(m.quantity)} {m.unit}</td>
                <td className="px-3 py-2 text-[#64748B] hidden sm:table-cell">{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------- view */

const InventoryView = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState("stock");
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "ingredients"], queryFn: getIngredients });
  const ingredients = data?.data?.data || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["inventory"] });

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[#64748B] leading-relaxed">
        Keep the shelf in the POS. Give each dish a recipe and every sale takes its ingredients off the shelf on its own;
        receive purchases and record wastage here. Low stock is flagged when the count reaches the reorder level.
      </p>
      <div className="flex gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`h-[36px] rounded-full px-4 text-[12.5px] font-bold ${tab === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "stock" && <StockTab ingredients={ingredients} refresh={refresh} />}
      {tab === "recipes" && <RecipesTab ingredients={ingredients} refresh={refresh} />}
      {tab === "log" && <LogTab />}
    </div>
  );
};

export default InventoryView;
