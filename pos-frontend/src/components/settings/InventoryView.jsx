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
import { STATUS, UNITS, qty, unitLabel, unitsLike } from "../../utils/inventory";

/**
 * Settings > Inventory Management.
 *
 * Dashboard: every item with its stock, minimum, maximum, cost price and
 * status, and the counts that need attention. Add stock as it is bought
 * (quantity, unit and what it cost), record wastage, or correct the count.
 * Recipes: what each product uses; also set in Manage Menu's product form.
 * Every sale then takes that off the shelf on its own
 * (pos-backend/services/inventory.js), and the POS alerts when an item
 * reaches its minimum.
 * Log: every movement, newest first.
 */

const CATEGORIES = [
  ["produce", "Produce"], ["meat", "Meat"], ["seafood", "Seafood"], ["dairy", "Dairy"],
  ["dry_goods", "Dry goods"], ["beverage", "Beverage"], ["other", "Other"],
];
const TABS = [["dashboard", "Dashboard"], ["recipes", "Recipes"], ["log", "Log"]];

const inputClass = "h-[40px] w-full rounded-xl border border-[#E2E8F0] bg-white px-3 text-[13px] font-bold text-[#0F172A] outline-none focus:border-[#FD5302]";
const labelClass = "block text-[11.5px] font-bold text-[#64748B] mb-1";
const btnPrimary = "h-[40px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502] disabled:opacity-50";
const btnGhost = "h-[36px] px-3 rounded-xl border border-[#E2E8F0] text-[#334155] text-[12.5px] font-bold hover:bg-[#F8FAFC] disabled:opacity-50";

const StatusBadge = ({ status }) => {
  const s = STATUS[status] || STATUS.in;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${s.className}`}>{s.label}</span>;
};

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
    <div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white p-5 shadow-2xl space-y-3" onClick={(e) => e.stopPropagation()}>
      <h3 className="text-[15px] font-extrabold text-[#0F172A]">{title}</h3>
      {children}
    </div>
  </div>
);

/* ------------------------------------------------------------ item form */

const EMPTY_ITEM = { name: "", unit: "pcs", category: "other", stockQuantity: "", reorderLevel: "", maxLevel: "", costPerUnit: "" };

/** Add a new item, or edit one (`item` set): name, unit, minimum, maximum, cost price. */
const ItemModal = ({ item, onClose, refresh }) => {
  const [form, setForm] = useState(() =>
    item
      ? { ...EMPTY_ITEM, ...item, reorderLevel: String(item.reorderLevel ?? ""), maxLevel: item.maxLevel ? String(item.maxLevel) : "", costPerUnit: String(item.costPerUnit ?? "") }
      : EMPTY_ITEM,
  );
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const done = (msg) => { enqueueSnackbar(msg, { variant: "success" }); refresh(); onClose(); };
  const fail = (e) => enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" });
  const body = () => ({
    name: form.name,
    unit: form.unit,
    category: form.category,
    reorderLevel: Number(form.reorderLevel) || 0,
    maxLevel: Number(form.maxLevel) || 0,
    costPerUnit: Number(form.costPerUnit) || 0,
  });
  const saveMut = useMutation({
    mutationFn: () => (item ? updateIngredient(item._id, body()) : createIngredient({ ...body(), stockQuantity: Number(form.stockQuantity) || 0 })),
    onSuccess: () => done(item ? "Item saved" : "Item added"),
    onError: fail,
  });
  const deleteMut = useMutation({ mutationFn: () => deleteIngredient(item._id), onSuccess: () => done("Item removed"), onError: fail });
  const min = Number(form.reorderLevel) || 0;
  const max = Number(form.maxLevel) || 0;
  const badRange = max > 0 && max <= min;
  const u = unitLabel(form.unit);

  return (
    <Modal title={item ? `Edit ${item.name}` : "Add inventory item"} onClose={onClose}>
      <div>
        <label className={labelClass}>Item name</label>
        <input autoFocus className={inputClass} placeholder="e.g. Pizza Dough, Mozzarella Cheese" value={form.name} onChange={set("name")} maxLength={120} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Unit</label>
          <select className={inputClass} value={form.unit} onChange={set("unit")}>
            {UNITS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelClass}>Category</label>
          <select className={inputClass} value={form.category} onChange={set("category")}>
            {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        {!item && (
          <div className="col-span-2">
            <label className={labelClass}>Current stock ({u})</label>
            <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={form.stockQuantity} onChange={set("stockQuantity")} placeholder="0" />
          </div>
        )}
        <div>
          <label className={labelClass}>Minimum stock ({u})</label>
          <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={form.reorderLevel} onChange={set("reorderLevel")} placeholder="Alert at" />
        </div>
        <div>
          <label className={labelClass}>Maximum stock ({u})</label>
          <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={form.maxLevel} onChange={set("maxLevel")} placeholder="Optional" />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Cost price (₹ per {u})</label>
          <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={form.costPerUnit} onChange={set("costPerUnit")} placeholder="Updated by each stock purchase" />
        </div>
      </div>
      {badRange && <p className="text-[12px] font-bold text-[#B91C1C]">Maximum stock must be more than the minimum stock.</p>}
      {item && item.unit !== form.unit && (
        <p className="text-[12px] text-[#64748B]">Stock, minimum, maximum and cost are converted to {u} where the units are the same kind of measure.</p>
      )}
      <div className="flex gap-2 pt-1">
        {item && (
          <button type="button" className={`${btnGhost} h-[40px]`} disabled={deleteMut.isPending}
            onClick={() => { if (window.confirm(`Remove ${item.name}? Recipes that use it stop taking it.`)) deleteMut.mutate(); }}>
            Remove
          </button>
        )}
        <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={onClose}>Back</button>
        <button type="button" className={`${btnPrimary} flex-1`} disabled={!form.name.trim() || badRange || saveMut.isPending} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
};

/* ----------------------------------------------------------- stock entry */

const MOVE_TITLE = { purchase: "Add stock", waste: "Record wastage", adjustment: "Correct the count" };

/** Stock in or out for one item. A purchase takes the quantity in any unit of its kind, and what it cost in total. */
const StockModal = ({ item, type, onClose, refresh }) => {
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState(item.unit);
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const moveMut = useMutation({
    mutationFn: () => recordStockMovement({
      ingredientId: item._id, type, quantity: Number(amount), unit,
      totalCost: type === "purchase" && cost !== "" ? Number(cost) : undefined, reason,
    }),
    onSuccess: () => { enqueueSnackbar("Stock updated", { variant: "success" }); refresh(); onClose(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not update stock", { variant: "error" }),
  });
  const n = Number(amount);
  const perUnit = type === "purchase" && n > 0 && Number(cost) > 0 ? Number(cost) / n : null;

  return (
    <Modal title={`${MOVE_TITLE[type]} · ${item.name}`} onClose={onClose}>
      <p className="text-[12px] text-[#64748B] -mt-2">Now {qty(item.stockQuantity)} {unitLabel(item.unit)}.</p>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={labelClass}>{type === "adjustment" ? "Actual count" : type === "purchase" ? "Quantity bought" : "Quantity lost"}</label>
          <input autoFocus className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>Unit</label>
          <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={type === "adjustment"}>
            {unitsLike(item.unit).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </div>
      </div>
      {type === "purchase" && (
        <div>
          <label className={labelClass}>Total cost price (₹)</label>
          <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="What this purchase cost" />
          {perUnit !== null && (
            <p className="mt-1 text-[11.5px] text-[#64748B]">₹{qty(perUnit)} per {unitLabel(unit)}</p>
          )}
        </div>
      )}
      <input className={`${inputClass} font-medium`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200}
        placeholder={type === "waste" ? "Reason (spoiled, spilled, expired…)" : "Note (optional, e.g. supplier)"} />
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={onClose}>Back</button>
        <button type="button" className={`${btnPrimary} flex-1`}
          disabled={amount === "" || (type !== "adjustment" && !(n > 0)) || moveMut.isPending || (type === "waste" && !reason.trim())}
          onClick={() => moveMut.mutate()}>
          {moveMut.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
};

/* ------------------------------------------------------------- dashboard */

const Card = ({ label, value, tone, active, onClick }) => (
  <button type="button" onClick={onClick}
    className={`rounded-2xl border p-3 text-left transition ${active ? "border-[#FD5302] ring-1 ring-[#FD5302]" : "border-[#E2E8F0] hover:border-[#CBD5E1]"} bg-white`}>
    <span className="block text-[11.5px] font-bold text-[#64748B]">{label}</span>
    <span className={`block text-[22px] font-black tabular-nums ${tone}`}>{value}</span>
  </button>
);

/** An item's four actions, in the table row (desktop) and on its card (phones). */
const ItemActions = ({ item, setMove, setEditing }) => (
  <>
    <button type="button" className={btnGhost} onClick={() => setMove({ item, type: "purchase" })}>+ Stock</button>
    <button type="button" className={btnGhost} onClick={() => setMove({ item, type: "waste" })}>Waste</button>
    <button type="button" className={btnGhost} onClick={() => setMove({ item, type: "adjustment" })}>Count</button>
    <button type="button" className={btnGhost} onClick={() => setEditing(item)}>Edit</button>
  </>
);

const DashboardTab = ({ ingredients, refresh }) => {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | item
  const [move, setMove] = useState(null); // { item, type }

  const count = (s) => ingredients.filter((i) => i.status === s).length;
  const rows = ingredients
    .filter((i) => filter === "all" || i.status === filter)
    .filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card label="Total items" value={ingredients.length} tone="text-[#0F172A]" active={filter === "all"} onClick={() => setFilter("all")} />
        <Card label="Low stock" value={count("low")} tone="text-[#B45309]" active={filter === "low"} onClick={() => setFilter("low")} />
        <Card label="Out of stock" value={count("out")} tone="text-[#B91C1C]" active={filter === "out"} onClick={() => setFilter("out")} />
        <Card label="At maximum stock" value={count("max")} tone="text-[#1D4ED8]" active={filter === "max"} onClick={() => setFilter("max")} />
      </div>

      {count("low") + count("out") > 0 && (
        <div className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-[12.5px] text-[#9A3412]">
          <span className="font-bold">Needs restocking:</span>{" "}
          {ingredients.filter((i) => i.status === "low" || i.status === "out").map((i) => `${i.name} (${qty(i.stockQuantity)} ${unitLabel(i.unit)})`).join(", ")}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input className={`${inputClass} font-medium flex-1 min-w-0`} placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className={`${btnPrimary} shrink-0 whitespace-nowrap`} onClick={() => setEditing("new")}>+ Add item</button>
      </div>

      {ingredients.length === 0 ? (
        <p className="bg-white border border-[#E2E8F0] rounded-2xl p-6 text-center text-[13px] text-[#94A3B8]">No inventory items yet. Add what you buy: pizza dough, mozzarella cheese, chicken sausage…</p>
      ) : rows.length === 0 ? (
        <p className="bg-white border border-[#E2E8F0] rounded-2xl p-6 text-center text-[13px] text-[#94A3B8]">No items match.</p>
      ) : (
        <>
          {/* Phones: one card per item, the actions a tap away. */}
          <div className="md:hidden space-y-2">
            {rows.map((i) => {
              const u = unitLabel(i.unit);
              return (
                <div key={i._id} className={`rounded-2xl border p-3 ${i.status === "out" ? "border-[#FECACA] bg-[#FEF2F2]" : i.status === "low" ? "border-[#FED7AA] bg-[#FFF7ED]" : "border-[#E2E8F0] bg-white"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="block font-bold text-[14px] text-[#0F172A] truncate">{i.name}</span>
                      <span className="block text-[11px] text-[#94A3B8]">{CATEGORIES.find(([k]) => k === i.category)?.[1] || i.category}</span>
                    </div>
                    <StatusBadge status={i.status} />
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-[20px] font-black tabular-nums text-[#0F172A]">{qty(i.stockQuantity)} <span className="text-[13px] font-bold">{u}</span></span>
                    {i.costPerUnit ? <span className="text-[12px] tabular-nums text-[#64748B]">₹{qty(i.costPerUnit)} / {u}</span> : null}
                  </div>
                  <p className="text-[11.5px] tabular-nums text-[#64748B]">
                    Min {i.reorderLevel ? `${qty(i.reorderLevel)} ${u}` : "—"} · Max {i.maxLevel ? `${qty(i.maxLevel)} ${u}` : "—"}
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    <ItemActions item={i} setMove={setMove} setEditing={setEditing} />
                  </div>
                </div>
              );
            })}
          </div>

      <div className="hidden md:block bg-white border border-[#E2E8F0] rounded-2xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Current stock</th>
                <th className="px-3 py-2 text-right">Min</th>
                <th className="px-3 py-2 text-right">Max</th>
                <th className="px-3 py-2 text-right">Cost price</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F5F9]">
              {rows.map((i) => {
                const u = unitLabel(i.unit);
                return (
                  <tr key={i._id} className={i.status === "out" ? "bg-[#FEF2F2]" : i.status === "low" ? "bg-[#FFF7ED]" : ""}>
                    <td className="px-3 py-2">
                      <span className="font-bold text-[#0F172A]">{i.name}</span>
                      <span className="block text-[11px] text-[#94A3B8]">{CATEGORIES.find(([k]) => k === i.category)?.[1] || i.category}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-extrabold tabular-nums text-[#0F172A] whitespace-nowrap">{qty(i.stockQuantity)} {u}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.reorderLevel ? `${qty(i.reorderLevel)} ${u}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.maxLevel ? `${qty(i.maxLevel)} ${u}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.costPerUnit ? `₹${qty(i.costPerUnit)} / ${u}` : "—"}</td>
                    <td className="px-3 py-2"><StatusBadge status={i.status} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <ItemActions item={i} setMove={setMove} setEditing={setEditing} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
      </div>
        </>
      )}

      {editing && <ItemModal item={editing === "new" ? null : editing} onClose={() => setEditing(null)} refresh={refresh} />}
      {move && <StockModal item={move.item} type={move.type} onClose={() => setMove(null)} refresh={refresh} />}
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
  const recipes = useMemo(() => recipesRes?.data?.data || [], [recipesRes]);
  const byDish = useMemo(() => new Map(recipes.map((r) => [String(r.menuItemId), r])), [recipes]);

  const [dishId, setDishId] = useState("");
  const [rows, setRows] = useState([]); // [{ingredientId, quantity, unit}]
  const [yieldN, setYieldN] = useState(1);
  const [search, setSearch] = useState("");

  const unitOf = (id) => ingredients.find((i) => i._id === id)?.unit || "";
  const pick = (id) => {
    setDishId(id);
    const r = byDish.get(id);
    setRows(r ? r.ingredients.map((i) => ({ ingredientId: String(i.ingredientId), quantity: String(i.quantity), unit: i.unit || unitOf(String(i.ingredientId)) })) : [{ ingredientId: "", quantity: "", unit: "" }]);
    setYieldN(r?.yield || 1);
  };
  const saveMut = useMutation({
    mutationFn: () => {
      const dish = dishes.find((d) => d.id === dishId);
      return upsertRecipe(dishId, {
        menuItemName: dish?.name,
        yield: Number(yieldN) || 1,
        ingredients: rows.filter((r) => r.ingredientId && Number(r.quantity) > 0).map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity), unit: r.unit || unitOf(r.ingredientId) })),
      });
    },
    onSuccess: () => { enqueueSnackbar("Recipe saved", { variant: "success" }); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save the recipe", { variant: "error" }),
  });
  const delMut = useMutation({
    mutationFn: () => deleteRecipe(dishId),
    onSuccess: () => { enqueueSnackbar("Recipe removed", { variant: "success" }); setRows([{ ingredientId: "", quantity: "", unit: "" }]); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not remove", { variant: "error" }),
  });
  const filtered = dishes.filter((d) => `${d.name} ${d.category}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 300);
  const setRow = (i, patch) => setRows(rows.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    // Phones show one side at a time: the product list, then the picked product's recipe.
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div className={`md:col-span-2 bg-white border border-[#E2E8F0] rounded-2xl p-3 ${dishId ? "hidden md:block" : ""}`}>
        <input className={`${inputClass} mb-2 font-medium`} placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[60dvh] md:max-h-[420px] overflow-y-auto divide-y divide-[#F1F5F9]">
          {filtered.map((d) => {
            const r = byDish.get(d.id);
            return (
              <button key={d.id} type="button" onClick={() => pick(d.id)} className={`w-full text-left px-2 py-2 hover:bg-[#F8FAFC] ${dishId === d.id ? "bg-[#FFF1E8]" : ""}`}>
                <span className="block text-[13px] font-bold text-[#0F172A]">{d.name}</span>
                <span className="block text-[11px] text-[#94A3B8]">
                  {d.category}{r ? ` · ${r.ingredients.length} item(s)${r.isActive === false ? " · off" : ""}` : " · no recipe"}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">No products.</p>}
        </div>
      </div>
      <div className={`md:col-span-3 bg-white border border-[#E2E8F0] rounded-2xl p-4 ${dishId ? "" : "hidden md:block"}`}>
        {dishId && (
          <button type="button" className="md:hidden mb-2 text-[12.5px] font-bold text-[#C2410C]" onClick={() => setDishId("")}>
            ← All products
          </button>
        )}
        {!dishId ? (
          <p className="text-[13px] text-[#94A3B8]">Pick a product to set what one serving uses. You can also set it in Manage Menu, under the product&apos;s price.</p>
        ) : ingredients.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">Add inventory items on the Dashboard first.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[13px] font-extrabold text-[#0F172A]">{dishes.find((d) => d.id === dishId)?.name}</p>
            <label className="flex items-center gap-2 text-[12.5px] text-[#475569] whitespace-nowrap">
              This recipe makes
              <input className={`${inputClass} max-w-[80px]`} type="number" min="1" value={yieldN} onChange={(e) => setYieldN(e.target.value)} />
              serving(s)
            </label>
            {rows.map((r, i) => (
              // Phones: the item on its own line, quantity and unit below it.
              <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 pb-2 sm:pb-0 border-b border-[#F1F5F9] sm:border-0">
                <select className={`${inputClass} basis-full sm:basis-auto sm:flex-1`} value={r.ingredientId} onChange={(e) => setRow(i, { ingredientId: e.target.value, unit: unitOf(e.target.value) })}>
                  <option value="">Item…</option>
                  {ingredients.map((ing) => <option key={ing._id} value={ing._id}>{ing.name}</option>)}
                </select>
                <input className={`${inputClass} flex-1 min-w-0 sm:flex-none sm:w-[90px]`} type="number" min="0" step="any" inputMode="decimal" placeholder="Qty" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} />
                <select className={`${inputClass} flex-1 min-w-0 sm:flex-none sm:w-[96px]`} value={r.unit || unitOf(r.ingredientId)} disabled={!r.ingredientId} onChange={(e) => setRow(i, { unit: e.target.value })}>
                  {unitsLike(unitOf(r.ingredientId)).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                </select>
                <button type="button" aria-label="Remove" className="w-8 h-[40px] shrink-0 text-[18px] text-[#94A3B8] hover:text-[#DC2626]" onClick={() => setRows(rows.filter((_, k) => k !== i))}>&times;</button>
              </div>
            ))}
            <button type="button" className="text-[12.5px] font-bold text-[#C2410C] hover:underline" onClick={() => setRows([...rows, { ingredientId: "", quantity: "", unit: "" }])}>+ Add item</button>
            <div className="flex gap-2 pt-2">
              {byDish.has(dishId) && <button type="button" className={`${btnGhost} h-[40px] flex-1 sm:flex-none`} onClick={() => delMut.mutate()}>Remove recipe</button>}
              <button type="button" className={`${btnPrimary} flex-1 sm:flex-none`} disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>{saveMut.isPending ? "Saving…" : "Save recipe"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------- log */

const TYPE_LABEL = { purchase: "Stock added", sale: "Sold", waste: "Wastage", adjustment: "Count", transfer: "Transfer" };

const LogTab = () => {
  const { data } = useQuery({ queryKey: ["inventory", "movements"], queryFn: () => getStockMovements({ limit: 200 }) });
  const rows = data?.data?.data || [];
  const amount = (m) => (
    <span className={`font-bold tabular-nums whitespace-nowrap ${m.quantity < 0 ? "text-[#DC2626]" : "text-[#16A34A]"}`}>
      {m.quantity > 0 ? "+" : ""}{qty(m.quantity)} {unitLabel(m.unit)}
    </span>
  );
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-x-auto">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-[13px] text-[#94A3B8]">Nothing has moved yet.</p>
      ) : (
        <>
        {/* Phones: one compact row per movement. */}
        <ul className="md:hidden divide-y divide-[#F1F5F9]">
          {rows.map((m) => (
            <li key={m._id} className="px-3 py-2.5 text-[12.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-[#0F172A] truncate">{m.ingredientName}</span>
                {amount(m)}
              </div>
              <div className="flex items-baseline justify-between gap-2 text-[11.5px] text-[#64748B]">
                <span className="truncate">{TYPE_LABEL[m.type] || m.type}{m.reason ? ` · ${m.reason}` : ""}</span>
                <span className="whitespace-nowrap">{m.cost ? `₹${qty(m.cost)} · ` : ""}{when(m.createdAt)}</span>
              </div>
            </li>
          ))}
        </ul>
        <table className="hidden md:table w-full min-w-[560px] text-[12.5px]">
          <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
            <tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-left">Type</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-[#F1F5F9]">
            {rows.map((m) => (
              <tr key={m._id}>
                <td className="px-3 py-2 text-[#64748B] whitespace-nowrap">{when(m.createdAt)}</td>
                <td className="px-3 py-2 font-bold text-[#0F172A]">{m.ingredientName}</td>
                <td className="px-3 py-2">{TYPE_LABEL[m.type] || m.type}</td>
                <td className="px-3 py-2 text-right">{amount(m)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{m.cost ? `₹${qty(m.cost)}` : ""}</td>
                <td className="px-3 py-2 text-[#64748B]">{m.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------- view */

const InventoryView = () => {
  const qc = useQueryClient();
  const [tab, setTab] = useState("dashboard");
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "ingredients"], queryFn: getIngredients });
  const ingredients = data?.data?.data || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["inventory"] });

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`h-[36px] flex-1 sm:flex-none rounded-full px-4 text-[12.5px] font-bold ${tab === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardTab ingredients={ingredients} refresh={refresh} />}
      {tab === "recipes" && <RecipesTab ingredients={ingredients} refresh={refresh} />}
      {tab === "log" && <LogTab />}
    </div>
  );
};

export default InventoryView;
