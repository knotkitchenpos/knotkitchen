import React, { useState } from "react";
import { enqueueSnackbar } from "../../../utils/notify";
import { createIngredient, lookupBarcode, recordStockMovement, updateIngredient } from "../../../https";
import { UNITS, convertQty, qty, rupees, unitLabel } from "../../../utils/inventory";
import { Modal, boxClass, btnGhost, btnPrimary, inputClass, labelClass } from "./ui";
import { BarcodeField, useScannerKeys } from "./Scanner";

/**
 * Scan to add stock (owner, 2026-11-03). A delivery comes in: scan each
 * packet and it adds up (5 cheese blocks, 48 Coke); a barcode no item has yet
 * opens a filled-in item to save once (from KnotKitchen's list or Open Food
 * Facts), or links it to an item the store already has. Then the cost, and
 * everything goes in at once.
 */

const CATEGORIES = [
  ["produce", "Produce"], ["meat", "Meat"], ["seafood", "Seafood"], ["dairy", "Dairy"],
  ["dry_goods", "Dry goods"], ["beverage", "Beverage"], ["other", "Other"],
];
const SOURCE = { openfoodfacts: "Open Food Facts", knotkitchen: "KnotKitchen's product list" };
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** A barcode no item has: save it as a new item, filled in from what it is, or add it to an item the store has. */
export const NewBarcode = ({ code, product, ingredients, onDone, onCancel }) => {
  const [mode, setMode] = useState("new");
  const [name, setName] = useState(product?.name || "");
  const [unit, setUnit] = useState(product?.unit || "pcs");
  const [category, setCategory] = useState(product?.category || "other");
  const [size, setSize] = useState(String(product?.size || 1));
  const [label, setLabel] = useState(product ? (product.unit === "pcs" && product.size > 1 ? `Pack of ${product.size}` : "Pack") : "");
  const [itemId, setItemId] = useState("");
  const [saving, setSaving] = useState(false);
  const item = ingredients.find((i) => i._id === itemId);
  const pickItem = (id) => {
    setItemId(id);
    const it = ingredients.find((i) => i._id === id);
    // The packet's size in that item's unit, where the two are the same kind of measure.
    const asItem = it && product ? convertQty(product.size, product.unit, it.unit) : null;
    setSize(String(asItem || 1));
  };
  const n = Number(size);
  const ok = n > 0 && (mode === "new" ? name.trim() : itemId);

  const save = async () => {
    setSaving(true);
    try {
      const barcode = { code, size: n, label: label.trim() };
      const res = mode === "new"
        ? await createIngredient({ name: name.trim(), unit, category, barcodes: [barcode] })
        : await updateIngredient(item._id, { barcodes: [...(item.barcodes || []), barcode] });
      onDone(res.data.data, n);
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const u = unitLabel(mode === "new" ? unit : item?.unit);
  return (
    <div className="rounded-xl border-2 border-[#FDBA8C] bg-[#FFF7F2] p-3 space-y-2.5">
      <div>
        <p className="text-[13px] font-extrabold text-[#0F172A]">New barcode {code}</p>
        <p className="text-[11.5px] text-[#64748B]">
          {product
            ? `Found on ${SOURCE[product.source] || "the product list"}${product.quantityText ? ` (${product.quantityText})` : ""}. Check it and save once; the next scan just adds stock.`
            : "Not found on any product list. Type what it is once; it is remembered for every scan after."}
        </p>
      </div>
      <div className="flex gap-1.5">
        {[["new", "New item"], ["existing", "An item I already have"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={`h-[32px] rounded-full px-3 text-[12px] font-bold ${mode === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] bg-white text-[#334155]"}`}>
            {l}
          </button>
        ))}
      </div>
      {mode === "new" ? (
        <>
          <div>
            <label className={labelClass}>Item name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Amul Cheese Block" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Counted in</label>
              <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
        </>
      ) : (
        <div>
          <label className={labelClass}>Item</label>
          <select className={inputClass} value={itemId} onChange={(e) => pickItem(e.target.value)}>
            <option value="">Pick the item…</option>
            {ingredients.map((i) => <option key={i._id} value={i._id}>{i.name}</option>)}
          </select>
        </div>
      )}
      <label className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#475569]">
        One
        <input className={`${boxClass} h-[34px] w-[110px] font-medium`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder="Pack" aria-label="Packet name" />
        is
        <input className={`${boxClass} h-[34px] w-[80px] text-right`} type="number" min="0" step="any" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} aria-label="Packet size" />
        {u || "…"}
      </label>
      <div className="flex gap-2">
        <button type="button" className={`${btnGhost} h-[38px] flex-1`} onClick={onCancel}>Skip</button>
        <button type="button" className={`${btnPrimary} h-[38px] flex-1`} disabled={!ok || saving} onClick={save}>{saving ? "Saving…" : "Save and add"}</button>
      </div>
    </div>
  );
};

const ScanStockModal = ({ ingredients, onClose, refresh }) => {
  const [lines, setLines] = useState([]); // [{ item, quantity, cost }]
  const [pending, setPending] = useState(null); // { code, product }: a barcode no item has
  const [saving, setSaving] = useState(false);

  const add = (item, size) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.item._id === item._id);
      if (i < 0) return [{ item, quantity: String(r3(size)), cost: "" }, ...prev];
      const copy = [...prev];
      copy[i] = { ...copy[i], quantity: String(r3(Number(copy[i].quantity) + size)) };
      return copy;
    });
    enqueueSnackbar(`${item.name} +${qty(size)} ${unitLabel(item.unit)}`, { variant: "success", autoHideDuration: 1200 });
  };
  const onCode = async (code) => {
    if (pending) return;
    try {
      const d = (await lookupBarcode(code)).data.data;
      if (d.item) add(d.item, Number(d.size) || 1);
      else setPending({ code: d.code, product: d.product });
    } catch (e) {
      enqueueSnackbar(e.response?.data?.message || "Could not read that barcode", { variant: "error" });
    }
  };
  // A scanner used while a quantity or cost box has focus: the box gets back what it had, and the scan counts.
  useScannerKeys((code, { target, before }) => {
    const { line, field } = target.dataset;
    if (line && field) setLines((prev) => prev.map((l) => (l.item._id === line ? { ...l, [field]: before } : l)));
    onCode(code);
  });
  const setLine = (i, patch) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const ready = lines.filter((l) => Number(l.quantity) > 0);
  const total = ready.reduce((n, l) => n + (Number(l.cost) || 0), 0);

  const close = () => { if (!lines.length || window.confirm("Close without adding this stock?")) onClose(); };

  const save = async () => {
    setSaving(true);
    let done = 0;
    try {
      for (const l of ready) {
        await recordStockMovement({
          ingredientId: l.item._id, type: "purchase", quantity: Number(l.quantity), unit: l.item.unit,
          totalCost: l.cost !== "" ? Number(l.cost) : undefined, reason: "Scanned in",
        });
        done += 1;
      }
      enqueueSnackbar(`Stock added for ${done} item(s)`, { variant: "success" });
      refresh();
      onClose();
    } catch (e) {
      // What went in stays in; the rest is left on the list to try again.
      setLines(lines.filter((l) => !ready.slice(0, done).includes(l)));
      refresh();
      enqueueSnackbar(e.response?.data?.message || "Could not add all the stock", { variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Scan to add stock" onClose={close} wide>
      <p className="-mt-2 text-[12px] text-[#64748B]">Scan each packet as it comes in. Every scan adds one packet.</p>
      <BarcodeField onCode={onCode} paused={Boolean(pending)} />
      {pending && (
        <NewBarcode
          code={pending.code}
          product={pending.product}
          ingredients={ingredients}
          onCancel={() => setPending(null)}
          onDone={(item, size) => { setPending(null); refresh(); add(item, size); }}
        />
      )}
      {lines.length > 0 && (
        <div className="rounded-xl border border-[#E2E8F0] divide-y divide-[#F1F5F9]">
          {lines.map((l, i) => {
            return (
              <div key={l.item._id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="flex-1 min-w-[140px] text-[13px] font-bold text-[#0F172A] truncate">{l.item.name}</span>
                <input className={`${boxClass} h-[34px] w-[80px] text-right`} type="number" min="0" step="any" inputMode="decimal" value={l.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label={`${l.item.name} quantity`} data-scan="" data-line={l.item._id} data-field="quantity" />
                <span className="w-[40px] text-[12px] font-bold text-[#64748B]">{unitLabel(l.item.unit)}</span>
                <input className={`${boxClass} h-[34px] w-[100px] text-right font-medium`} type="number" min="0" step="any" inputMode="decimal" placeholder="₹ total" value={l.cost}
                  onChange={(e) => setLine(i, { cost: e.target.value })} aria-label={`${l.item.name} total cost`} data-scan="" data-line={l.item._id} data-field="cost" />
                <button type="button" aria-label="Remove" className="w-7 text-[18px] text-[#94A3B8] hover:text-[#DC2626]" onClick={() => setLines(lines.filter((_, k) => k !== i))}>&times;</button>
              </div>
            );
          })}
        </div>
      )}
      {lines.length > 0 && (
        <p className="text-[11.5px] text-[#64748B]">
          Enter what each cost in total to update its cost price; leave it blank to keep the price it has.{total > 0 ? ` Bill so far ${rupees(total)}.` : ""}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" className={`${btnGhost} h-[40px] flex-1`} onClick={close} disabled={saving}>Back</button>
        <button type="button" className={`${btnPrimary} flex-1`} disabled={!ready.length || saving || Boolean(pending)} onClick={save}>
          {saving ? "Adding…" : `Add ${ready.length} item(s) to stock`}
        </button>
      </div>
    </Modal>
  );
};

export default ScanStockModal;
