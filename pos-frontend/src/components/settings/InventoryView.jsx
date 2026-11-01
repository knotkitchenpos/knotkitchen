import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../utils/notify";
import {
  createIngredient,
  deleteIngredient,
  deleteRecipe,
  getIngredients,
  getMenus,
  getRecipes,
  getStockMovements,
  makePreparedBatch,
  recordStockMovement,
  updateIngredient,
  upsertRecipe,
} from "../../https";
import { dateTimeIN as when } from "../../utils";
import { STATUS, UNITS, foodCostTone, linesCost, qty, rupees, unitLabel, unitsLike } from "../../utils/inventory";
import { LinesEditor, Modal, btnGhost, btnPrimary, cleanLines, inputClass, labelClass, toRows } from "./inventory/ui";
import DishCostsTab from "./inventory/DishCostsTab";
import AddonsTab from "./inventory/AddonsTab";
import CountTab from "./inventory/CountTab";
import ReportsTab from "./inventory/ReportsTab";

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
const TABS = [
  ["dashboard", "Dashboard"], ["costs", "Dish costs"], ["recipes", "Recipes"], ["addons", "Add-ons"],
  ["count", "Stock count"], ["reports", "Reports"], ["log", "Log"],
];

const StatusBadge = ({ status }) => {
  const s = STATUS[status] || STATUS.in;
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${s.className}`}>{s.label}</span>;
};

const day = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** "1 L expired" / "2 L by 3 Nov": an item's use-by state, or nothing when it has no dated stock. */
const ExpiryNote = ({ item }) => {
  const e = item.expiry;
  if (!e || (!e.expired && !e.soon)) return null;
  const u = unitLabel(item.unit);
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${e.expired ? "bg-[#FEE2E2] text-[#991B1B]" : "bg-[#FEF3C7] text-[#92400E]"}`}>
      {e.expired ? `${qty(e.expired)} ${u} expired` : `${qty(e.soon)} ${u} by ${day(e.next)}`}
    </span>
  );
};

/* ------------------------------------------------------------ item form */

const EMPTY_ITEM = { name: "", unit: "pcs", category: "other", stockQuantity: "", reorderLevel: "", maxLevel: "", costPerUnit: "", shelfLifeDays: "" };

/**
 * Add a new item, or edit one (`item` set): name, unit, minimum, maximum, cost
 * price; the packs it is bought in; how many days it keeps; and, for a
 * prepared item, what one batch makes and uses.
 */
const ItemModal = ({ item, ingredients, onClose, refresh }) => {
  const [form, setForm] = useState(() =>
    item
      ? {
          ...EMPTY_ITEM, ...item, reorderLevel: String(item.reorderLevel ?? ""), maxLevel: item.maxLevel ? String(item.maxLevel) : "",
          costPerUnit: String(item.costPerUnit ?? ""), shelfLifeDays: item.shelfLifeDays ? String(item.shelfLifeDays) : "",
        }
      : EMPTY_ITEM,
  );
  const [packs, setPacks] = useState(() => (item?.packs || []).map((p) => ({ name: p.name, size: String(p.size) })));
  const [prepared, setPrepared] = useState(Boolean(item?.isPrepared));
  const [makes, setMakes] = useState(item?.prep?.makes ? String(item.prep.makes) : "");
  const [prepRows, setPrepRows] = useState(() => toRows(item?.prep?.ingredients || [], ingredients));
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
    shelfLifeDays: Number(form.shelfLifeDays) || 0,
    packs: packs.filter((p) => p.name.trim() && Number(p.size) > 0).map((p) => ({ name: p.name.trim(), size: Number(p.size) })),
    isPrepared: prepared,
    ...(prepared ? { prep: { makes: Number(makes) || 0, ingredients: cleanLines(prepRows, ingredients) } } : {}),
  });
  const batchCost = prepared ? linesCost(cleanLines(prepRows, ingredients), ingredients).cost : 0;
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
    <Modal title={item ? `Edit ${item.name}` : "Add inventory item"} onClose={onClose} wide>
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
        <div>
          <label className={labelClass}>Cost price (₹ per {u})</label>
          <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={form.costPerUnit} onChange={set("costPerUnit")} placeholder={prepared ? "Set by each batch" : "Set by each purchase"} />
        </div>
        <div>
          <label className={labelClass}>Keeps for (days)</label>
          <input className={inputClass} type="number" min="0" step="1" inputMode="numeric" value={form.shelfLifeDays} onChange={set("shelfLifeDays")} placeholder="Optional" />
        </div>
      </div>
      {badRange && <p className="text-[12px] font-bold text-[#B91C1C]">Maximum stock must be more than the minimum stock.</p>}
      {Number(form.shelfLifeDays) > 0 && (
        <p className="text-[11.5px] text-[#64748B]">Stock added gets a use-by date {form.shelfLifeDays} day(s) ahead, unless you give one; the oldest is used first.</p>
      )}

      {/* Bought in packs, used in the item's unit: a tray of 30 eggs. */}
      <div className="rounded-xl border border-[#E2E8F0] p-3 space-y-2">
        <p className="text-[12.5px] font-extrabold text-[#0F172A]">Packs you buy it in</p>
        {packs.map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={`${inputClass} flex-1 font-medium`} placeholder="Tray, Box, Bag…" maxLength={40} value={p.name}
              onChange={(e) => setPacks(packs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
            <span className="text-[12px] text-[#64748B]">=</span>
            <input className={`${inputClass} w-[86px]`} type="number" min="0" step="any" inputMode="decimal" placeholder="30" value={p.size}
              onChange={(e) => setPacks(packs.map((x, k) => (k === i ? { ...x, size: e.target.value } : x)))} />
            <span className="w-[44px] text-[12px] font-bold text-[#64748B]">{u}</span>
            <button type="button" aria-label="Remove pack" className="text-[18px] text-[#94A3B8] hover:text-[#DC2626]" onClick={() => setPacks(packs.filter((_, k) => k !== i))}>&times;</button>
          </div>
        ))}
        <button type="button" className="text-[12.5px] font-bold text-[#C2410C] hover:underline" onClick={() => setPacks([...packs, { name: "", size: "" }])}>
          + Add a pack
        </button>
        {!packs.length && <p className="text-[11.5px] text-[#94A3B8]">Optional. Then stock can be added as &quot;2 Trays&quot; while recipes keep using {u}.</p>}
      </div>

      {/* Prepared items: made in batches from other items. */}
      <div className="rounded-xl border border-[#E2E8F0] p-3 space-y-2">
        <label className="flex items-center justify-between gap-2">
          <span>
            <span className="block text-[12.5px] font-extrabold text-[#0F172A]">Prepared item</span>
            <span className="block text-[11.5px] text-[#94A3B8]">Made in batches from other items: gravy, dough, sauce.</span>
          </span>
          <input type="checkbox" className="w-5 h-5 accent-[#22C55E]" checked={prepared} onChange={(e) => setPrepared(e.target.checked)} />
        </label>
        {prepared && (
          <>
            <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#475569]">
              One batch makes
              <input className={`${inputClass} w-[90px]`} type="number" min="0" step="any" inputMode="decimal" value={makes} onChange={(e) => setMakes(e.target.value)} placeholder="5" />
              {u}, using:
            </label>
            <LinesEditor ingredients={ingredients} rows={prepRows} setRows={setPrepRows} exclude={item?._id} costLabel="Batch cost" />
            {batchCost > 0 && Number(makes) > 0 && (
              <p className="text-[11.5px] text-[#64748B]">{rupees(batchCost / Number(makes))} per {u}</p>
            )}
          </>
        )}
      </div>
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
        <button type="button" className={`${btnPrimary} flex-1`}
          disabled={!form.name.trim() || badRange || saveMut.isPending || (prepared && !(Number(makes) > 0 && cleanLines(prepRows, ingredients).length))}
          onClick={() => saveMut.mutate()}>
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
  // A unit code, or "pack:<name>" for one of the item's packs (2 Trays).
  const packs = type === "purchase" ? item.packs || [] : [];
  const [unit, setUnit] = useState(packs.length ? `pack:${packs[0].name}` : item.unit);
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const pack = unit.startsWith("pack:") ? packs.find((p) => `pack:${p.name}` === unit) : null;
  const moveMut = useMutation({
    mutationFn: () => recordStockMovement({
      ingredientId: item._id, type, quantity: Number(amount),
      ...(pack ? { pack: pack.name } : { unit }),
      totalCost: type === "purchase" && cost !== "" ? Number(cost) : undefined, reason,
      expiryDate: type === "purchase" && expiry ? expiry : undefined,
    }),
    onSuccess: () => { enqueueSnackbar("Stock updated", { variant: "success" }); refresh(); onClose(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not update stock", { variant: "error" }),
  });
  const n = Number(amount);
  const perUnit = type === "purchase" && n > 0 && Number(cost) > 0 ? Number(cost) / n : null;
  const unitName = pack ? pack.name : unitLabel(unit);

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
            {packs.map((p) => <option key={p.name} value={`pack:${p.name}`}>{p.name} ({qty(p.size)} {unitLabel(item.unit)})</option>)}
            {unitsLike(item.unit).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </div>
      </div>
      {pack && n > 0 && (
        <p className="-mt-1 text-[11.5px] text-[#64748B]">= {qty(n * pack.size)} {unitLabel(item.unit)}</p>
      )}
      {type === "purchase" && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass}>Total cost price (₹)</label>
            <input className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="What it cost" />
            {perUnit !== null && (
              <p className="mt-1 text-[11.5px] text-[#64748B]">{rupees(perUnit)} per {unitName}</p>
            )}
          </div>
          <div>
            <label className={labelClass}>Use by (optional)</label>
            <input className={inputClass} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            {!expiry && item.shelfLifeDays > 0 && <p className="mt-1 text-[11.5px] text-[#64748B]">Else {item.shelfLifeDays} day(s) from today</p>}
          </div>
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

/* ------------------------------------------------------------ make batch */

/**
 * A batch of a prepared item made: its recipe, scaled, comes off the shelf and
 * the batch goes on it. Short of something, the server says what and this asks
 * whether to make it anyway (the shelf count is often behind the kitchen).
 */
const MakeModal = ({ item, ingredients, onClose, refresh }) => {
  const [amount, setAmount] = useState(item.prep?.makes ? String(item.prep.makes) : "");
  const u = unitLabel(item.unit);
  const scale = Number(amount) / Math.max(1e-9, Number(item.prep?.makes) || 1);
  const needs = (item.prep?.ingredients || []).map((l) => {
    const ing = ingredients.find((i) => i._id === String(l.ingredientId));
    return ing ? { name: ing.name, unit: l.unit || ing.unit, need: (Number(l.quantity) || 0) * (Number.isFinite(scale) ? scale : 0) } : null;
  }).filter(Boolean);
  const makeMut = useMutation({
    mutationFn: (force) => makePreparedBatch(item._id, { quantity: Number(amount), force }),
    onSuccess: () => { enqueueSnackbar(`${qty(amount)} ${u} ${item.name} made`, { variant: "success" }); refresh(); onClose(); },
    onError: (e) => {
      const d = e.response?.data;
      if (d?.code === "STOCK_SHORT") {
        if (window.confirm(`${d.message}\n\nMake it anyway? Those items go to 0.`)) makeMut.mutate(true);
        return;
      }
      enqueueSnackbar(d?.message || "Could not make the batch", { variant: "error" });
    },
  });
  return (
    <Modal title={`Make ${item.name}`} onClose={onClose}>
      <p className="text-[12px] text-[#64748B] -mt-2">Now {qty(item.stockQuantity)} {u}. One batch makes {qty(item.prep?.makes)} {u}.</p>
      <div>
        <label className={labelClass}>Made ({u})</label>
        <input autoFocus className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {Number(amount) > 0 && needs.length > 0 && (
        <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[12.5px]">
          <p className="font-bold text-[#334155] mb-1">Takes off the shelf</p>
          {needs.map((n) => (
            <p key={n.name} className="flex justify-between tabular-nums text-[#475569]"><span>{n.name}</span><span>{qty(n.need)} {unitLabel(n.unit)}</span></p>
          ))}
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={onClose}>Back</button>
        <button type="button" className={`${btnPrimary} flex-1`} disabled={!(Number(amount) > 0) || makeMut.isPending} onClick={() => makeMut.mutate(false)}>
          {makeMut.isPending ? "Saving…" : "Made"}
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
const ItemActions = ({ item, setMove, setEditing, setMaking }) => (
  <>
    {item.isPrepared ? (
      <button type="button" className={btnGhost} onClick={() => setMaking(item)} title="A batch was made">Make</button>
    ) : (
      <button type="button" className={btnGhost} onClick={() => setMove({ item, type: "purchase" })}>+ Stock</button>
    )}
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
  const [making, setMaking] = useState(null); // a prepared item

  const count = (s) => ingredients.filter((i) => i.status === s).length;
  const expiring = ingredients.filter((i) => i.expiry && (i.expiry.expired || i.expiry.soon));
  const rows = ingredients
    .filter((i) => filter === "all" || (filter === "expiring" ? expiring.includes(i) : i.status === filter))
    .filter((i) => i.name.toLowerCase().includes(search.trim().toLowerCase()));
  const stockValue = ingredients.reduce((n, i) => n + Math.max(0, Number(i.stockQuantity) || 0) * (Number(i.costPerUnit) || 0), 0);
  const actions = { setMove, setEditing, setMaking };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Card label="Total items" value={ingredients.length} tone="text-[#0F172A]" active={filter === "all"} onClick={() => setFilter("all")} />
        <Card label="Low stock" value={count("low")} tone="text-[#B45309]" active={filter === "low"} onClick={() => setFilter("low")} />
        <Card label="Out of stock" value={count("out")} tone="text-[#B91C1C]" active={filter === "out"} onClick={() => setFilter("out")} />
        <Card label="At maximum stock" value={count("max")} tone="text-[#1D4ED8]" active={filter === "max"} onClick={() => setFilter("max")} />
        <Card label="Expiring / expired" value={expiring.length} tone={expiring.length ? "text-[#B91C1C]" : "text-[#0F172A]"} active={filter === "expiring"} onClick={() => setFilter("expiring")} />
        <Card label="Stock value" value={rupees(Math.round(stockValue))} tone="text-[#0F172A]" active={false} onClick={() => setFilter("all")} />
      </div>

      {expiring.length > 0 && (
        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#991B1B]">
          <span className="font-bold">Use first:</span>{" "}
          {expiring.map((i) => `${i.name} (${i.expiry.expired ? `${qty(i.expiry.expired)} ${unitLabel(i.unit)} expired` : `${qty(i.expiry.soon)} ${unitLabel(i.unit)} by ${day(i.expiry.next)}`})`).join(", ")}
          . Throw away what has expired with Waste.
        </div>
      )}

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
                      <span className="block text-[11px] text-[#94A3B8]">
                        {CATEGORIES.find(([k]) => k === i.category)?.[1] || i.category}{i.isPrepared ? " · prepared" : ""}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StatusBadge status={i.status} />
                      <ExpiryNote item={i} />
                    </div>
                  </div>
                  <div className="mt-2 flex items-baseline justify-between gap-2">
                    <span className="text-[20px] font-black tabular-nums text-[#0F172A]">{qty(i.stockQuantity)} <span className="text-[13px] font-bold">{u}</span></span>
                    {i.costPerUnit ? <span className="text-[12px] tabular-nums text-[#64748B]">₹{qty(i.costPerUnit)} / {u}</span> : null}
                  </div>
                  <p className="text-[11.5px] tabular-nums text-[#64748B]">
                    Min {i.reorderLevel ? `${qty(i.reorderLevel)} ${u}` : "—"} · Max {i.maxLevel ? `${qty(i.maxLevel)} ${u}` : "—"}
                  </p>
                  <div className="mt-2 grid grid-cols-4 gap-1.5">
                    <ItemActions item={i} {...actions} />
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
                      <span className="block text-[11px] text-[#94A3B8]">
                        {CATEGORIES.find(([k]) => k === i.category)?.[1] || i.category}{i.isPrepared ? " · prepared" : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-extrabold tabular-nums text-[#0F172A] whitespace-nowrap">{qty(i.stockQuantity)} {u}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.reorderLevel ? `${qty(i.reorderLevel)} ${u}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.maxLevel ? `${qty(i.maxLevel)} ${u}` : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{i.costPerUnit ? `₹${qty(i.costPerUnit)} / ${u}` : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={i.status} />
                        <ExpiryNote item={i} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <ItemActions item={i} {...actions} />
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

      {editing && <ItemModal item={editing === "new" ? null : editing} ingredients={ingredients} onClose={() => setEditing(null)} refresh={refresh} />}
      {move && <StockModal item={move.item} type={move.type} onClose={() => setMove(null)} refresh={refresh} />}
      {making && <MakeModal item={making} ingredients={ingredients} onClose={() => setMaking(null)} refresh={refresh} />}
    </div>
  );
};

/* ---------------------------------------------------------------- recipes */

const RecipesTab = ({ ingredients, refresh, initialDish, target = 35 }) => {
  const { data: menusRes } = useQuery({ queryKey: ["menus", "draft-for-recipes"], queryFn: () => getMenus() });
  const { data: recipesRes } = useQuery({ queryKey: ["inventory", "recipes"], queryFn: getRecipes });
  const dishes = useMemo(() => {
    const menus = menusRes?.data?.data || [];
    return (Array.isArray(menus) ? menus : []).flatMap((m) => (m.items || []).map((it) => ({ id: String(it._id), name: it.name, category: m.name, price: Number(it.price) || 0 })));
  }, [menusRes]);
  const recipes = useMemo(() => recipesRes?.data?.data || [], [recipesRes]);
  const byDish = useMemo(() => new Map(recipes.map((r) => [String(r.menuItemId), r])), [recipes]);

  const [dishId, setDishId] = useState("");
  const [rows, setRows] = useState([]); // [{ingredientId, quantity, unit}]
  const [yieldN, setYieldN] = useState(1);
  const [search, setSearch] = useState("");

  const pick = (id) => {
    setDishId(id);
    const r = byDish.get(id);
    setRows(toRows(r?.ingredients || [], ingredients));
    setYieldN(r?.yield || 1);
  };
  // Opened from Dish costs' "Edit recipe": that product, once the lists are in.
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (initialDish && !opened.current && recipesRes && dishes.length) {
      opened.current = true;
      pick(initialDish);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDish, recipesRes, dishes.length]);
  const dish = dishes.find((d) => d.id === dishId);
  const serving = linesCost(cleanLines(rows, ingredients), ingredients).cost / Math.max(1, Number(yieldN) || 1);
  const pct = dish?.price > 0 && serving > 0 ? Math.round((serving / dish.price) * 1000) / 10 : null;
  const saveMut = useMutation({
    mutationFn: () => upsertRecipe(dishId, {
      menuItemName: dish?.name,
      yield: Number(yieldN) || 1,
      ingredients: cleanLines(rows, ingredients),
    }),
    onSuccess: () => { enqueueSnackbar("Recipe saved", { variant: "success" }); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save the recipe", { variant: "error" }),
  });
  const delMut = useMutation({
    mutationFn: () => deleteRecipe(dishId),
    onSuccess: () => { enqueueSnackbar("Recipe removed", { variant: "success" }); setRows(toRows([], ingredients)); refresh(); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not remove", { variant: "error" }),
  });
  const filtered = dishes.filter((d) => `${d.name} ${d.category}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 300);

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
            <p className="text-[13px] font-extrabold text-[#0F172A]">{dish?.name}</p>
            <label className="flex items-center gap-2 text-[12.5px] text-[#475569] whitespace-nowrap">
              This recipe makes
              <input className={`${inputClass} max-w-[80px]`} type="number" min="1" value={yieldN} onChange={(e) => setYieldN(e.target.value)} />
              serving(s)
            </label>
            <LinesEditor ingredients={ingredients} rows={rows} setRows={setRows} divideBy={yieldN} costLabel="Cost per serving" />
            {serving > 0 && dish?.price > 0 && (
              <div className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] p-3 text-[12.5px] tabular-nums text-[#334155]">
                Costs <b>{rupees(serving)}</b> to make, sells for <b>{rupees(dish.price)}</b>: profit{" "}
                <b className={dish.price - serving < 0 ? "text-[#B91C1C]" : ""}>{rupees(dish.price - serving)}</b>, food cost{" "}
                <b className={foodCostTone(pct, target)}>{pct}%</b>
                {pct > target && <span className="text-[#B91C1C]"> (above your {target}% target)</span>}.
              </div>
            )}
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

const TYPE_LABEL = { purchase: "Stock added", sale: "Sold", waste: "Wastage", adjustment: "Correction", transfer: "Transfer", production: "Batch made", count: "Stock count" };

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
  const [recipeFor, setRecipeFor] = useState(null); // a product opened from Dish costs
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "ingredients"], queryFn: getIngredients });
  const ingredients = data?.data?.data || [];
  const target = data?.data?.settings?.targetFoodCostPct ?? 35;
  const refresh = () => qc.invalidateQueries({ queryKey: ["inventory"] });
  const go = (k) => { setTab(k); if (k !== "recipes") setRecipeFor(null); };

  if (isLoading) return <div className="p-8 text-center text-[#94A3B8]">Loading…</div>;
  return (
    <div className="space-y-4">
      {/* Seven tabs: one scrolling row on a phone. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => go(k)} className={`h-[36px] shrink-0 rounded-full px-4 text-[12.5px] font-bold whitespace-nowrap ${tab === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardTab ingredients={ingredients} refresh={refresh} />}
      {tab === "costs" && <DishCostsTab onEditRecipe={(id) => { setRecipeFor(id); setTab("recipes"); }} />}
      {tab === "recipes" && <RecipesTab key={recipeFor || "all"} ingredients={ingredients} refresh={refresh} initialDish={recipeFor} target={target} />}
      {tab === "addons" && <AddonsTab ingredients={ingredients} />}
      {tab === "count" && <CountTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "log" && <LogTab />}
    </div>
  );
};

export default InventoryView;
