import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../../utils/notify";
import { cancelStockCount, finishStockCount, getIngredients, getInventorySettings, getStockCount, getStockCounts, saveInventorySettings, saveStockCount, startStockCount } from "../../../https";
import { dateTimeIN as when } from "../../../utils";
import { qty, rupees, unitLabel } from "../../../utils/inventory";
import { boxClass, btnGhost, btnPrimary, card, inputClass } from "./ui";
import { BarcodeField, useScannerKeys } from "./Scanner";

/**
 * Stock count (owner, 2026-11-01). Staff count every item on a phone; what
 * the system expects stays hidden while they count, so nobody just copies it.
 * Finishing sets each counted item to its count and shows the differences in
 * quantity and ₹ ("Chicken: 2.3 KG missing, ₹690"): theft, over-portioning,
 * wastage nobody recorded. Blank items are left as they are.
 */

const CATEGORY = { produce: "Produce", meat: "Meat", seafood: "Seafood", dairy: "Dairy", dry_goods: "Dry goods", beverage: "Beverage", other: "Other" };

/** A finished count's differences, biggest ₹ first. */
const Differences = ({ count, onBack }) => {
  const lines = (count.lines || [])
    .filter((l) => l.counted !== null && l.counted !== undefined)
    .map((l) => ({ ...l, diff: Math.round((l.counted - l.expected) * 1000) / 1000, value: Math.round((l.counted - l.expected) * (l.costPerUnit || 0) * 100) / 100 }));
  const changed = lines.filter((l) => l.diff !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || Math.abs(b.diff) - Math.abs(a.diff));
  const t = count.totals || {};
  return (
    <div className="space-y-4">
      <button type="button" className="text-[12.5px] font-bold text-[#C2410C]" onClick={onBack}>← Stock counts</button>
      <div>
        <h3 className="text-[15px] font-extrabold text-[#0F172A]">Stock count #{count.number}</h3>
        <p className="text-[12px] text-[#64748B]">{count.finishedAt ? `Finished ${when(count.finishedAt)}` : ""} · {t.counted} item(s) counted</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className={`${card} p-3`}><span className="block text-[11.5px] font-bold text-[#64748B]">Missing</span><span className="block text-[20px] font-black tabular-nums text-[#B91C1C]">{rupees(t.missing)}</span></div>
        <div className={`${card} p-3`}><span className="block text-[11.5px] font-bold text-[#64748B]">Extra</span><span className="block text-[20px] font-black tabular-nums text-[#15803D]">{rupees(t.extra)}</span></div>
        <div className={`${card} p-3`}><span className="block text-[11.5px] font-bold text-[#64748B]">Matched</span><span className="block text-[20px] font-black tabular-nums">{lines.length - changed.length}</span></div>
      </div>
      {changed.length === 0 ? (
        <p className={`${card} p-6 text-center text-[13px] text-[#15803D] font-bold`}>Everything counted matched the system.</p>
      ) : (
        <ul className={`${card} divide-y divide-[#F1F5F9]`}>
          {changed.map((l) => {
            const u = unitLabel(l.unit);
            return (
              <li key={String(l.ingredientId)} className="px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-[13px] text-[#0F172A] truncate">{l.name}</span>
                  <span className={`text-[13px] font-black tabular-nums ${l.diff < 0 ? "text-[#B91C1C]" : "text-[#15803D]"}`}>
                    {qty(Math.abs(l.diff))} {u} {l.diff < 0 ? "missing" : "extra"}{l.value ? `, ${rupees(Math.abs(l.value))}` : ""}
                  </span>
                </div>
                <p className="text-[11.5px] tabular-nums text-[#64748B]">System said {qty(l.expected)} {u} · counted {qty(l.counted)} {u}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/** Counting: every item, grouped by category, with a box for what is on the shelf. */
const Counting = ({ countId, onDone, onBack }) => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["inventory", "count", countId], queryFn: () => getStockCount(countId), refetchOnWindowFocus: false });
  const count = data?.data?.data;
  const [values, setValues] = useState(null); // ingredientId -> string
  const [search, setSearch] = useState("");
  const [onlyLeft, setOnlyLeft] = useState(false);
  const [scan, setScan] = useState(false);
  const dirty = useRef(false);
  // Barcode -> the item and what one packet is, from the items' barcodes.
  const { data: itemsRes } = useQuery({ queryKey: ["inventory", "ingredients"], queryFn: getIngredients });
  const byCode = useMemo(() => {
    const m = new Map();
    for (const i of itemsRes?.data?.data || []) for (const b of i.barcodes || []) m.set(b.code, { id: String(i._id), size: Number(b.size) || 1 });
    return m;
  }, [itemsRes]);
  /** A packet scanned on the shelf: its item's count goes up by one packet. */
  // `base`: the counts to add to; a scan typed into a count box first puts that box back.
  const onCode = (code, base = values) => {
    const hit = byCode.get(code);
    const line = hit && count?.lines.find((l) => String(l.ingredientId) === hit.id);
    if (base !== values) { dirty.current = true; setValues(base); }
    if (!line) {
      enqueueSnackbar(hit ? "That item was added after this count started." : `Barcode ${code} is not on any item. Add it in the item's Edit, then scan again.`, { variant: "warning" });
      return;
    }
    dirty.current = true;
    const now = Math.round(((Number(base[hit.id]) || 0) + hit.size) * 1000) / 1000;
    setValues({ ...base, [hit.id]: String(now) });
    enqueueSnackbar(`${line.name}: ${qty(now)} ${unitLabel(line.unit)}`, { variant: "success", autoHideDuration: 1200 });
  };

  // A scanner used while a count box has focus: the box gets back what it had, and the scan counts.
  useScannerKeys((code, { target, before }) => {
    const id = target.dataset.line;
    onCode(code, id && values ? { ...values, [id]: before } : values);
  }, Boolean(values));

  useEffect(() => {
    if (count && values === null) {
      setValues(Object.fromEntries(count.lines.map((l) => [String(l.ingredientId), l.counted === null || l.counted === undefined ? "" : String(l.counted)])));
    }
  }, [count, values]);

  const payload = () => ({ lines: Object.entries(values || {}).map(([ingredientId, v]) => ({ ingredientId, counted: v === "" ? null : Number(v) })) });
  const saveMut = useMutation({ mutationFn: () => saveStockCount(countId, payload()), onSuccess: () => { dirty.current = false; } });
  // Saved a moment after typing stops, so a count can be finished later or on another phone.
  useEffect(() => {
    if (!dirty.current) return undefined;
    const t = setTimeout(() => saveMut.mutate(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const finishMut = useMutation({
    mutationFn: async () => {
      await saveStockCount(countId, payload());
      return finishStockCount(countId);
    },
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["inventory"] }); onDone(res.data.data); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not finish the count", { variant: "error" }),
  });
  const cancelMut = useMutation({
    mutationFn: () => cancelStockCount(countId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["inventory"] }); onBack(); },
  });

  const groups = useMemo(() => {
    if (!count || !values) return [];
    const m = new Map();
    for (const l of count.lines) {
      if (!l.name.toLowerCase().includes(search.trim().toLowerCase())) continue;
      if (onlyLeft && values[String(l.ingredientId)] !== "") continue;
      const k = CATEGORY[l.category] || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    }
    return [...m.entries()];
  }, [count, values, search, onlyLeft]);

  if (!count || !values) return <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>;
  const done = Object.values(values).filter((v) => v !== "").length;
  const total = count.lines.length;

  return (
    <div className="space-y-3">
      <button type="button" className="text-[12.5px] font-bold text-[#C2410C]" onClick={onBack}>← Stock counts</button>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-extrabold text-[#0F172A]">Stock count #{count.number}</h3>
          <p className="text-[12px] text-[#64748B]">
            {done} of {total} counted{saveMut.isPending ? " · saving…" : dirty.current ? "" : done ? " · saved" : ""}. Count what is on the shelf; leave an item blank to skip it.
          </p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-[#F1F5F9] overflow-hidden">
        <div className="h-full bg-[#FD5302] transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${inputClass} font-medium flex-1 min-w-[180px]`} placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="flex items-center gap-1.5 text-[12.5px] font-bold text-[#334155]">
          <input type="checkbox" className="w-4 h-4 accent-[#FD5302]" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} />
          Not counted yet
        </label>
        {byCode.size > 0 && (
          <button type="button" className={`${btnGhost} h-[40px]`} onClick={() => setScan((x) => !x)}>{scan ? "Stop scanning" : "Scan packets"}</button>
        )}
      </div>
      {scan && (
        <div className={`${card} p-3 space-y-1`}>
          <BarcodeField onCode={onCode} placeholder="Scan each packet on the shelf" />
          <p className="text-[11.5px] text-[#94A3B8]">Each scan adds one packet to that item&apos;s count. Loose items are typed in below.</p>
        </div>
      )}

      {groups.map(([category, lines]) => (
        <div key={category} className={card}>
          <p className="px-3 pt-2.5 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider text-[#94A3B8]">{category}</p>
          <ul className="divide-y divide-[#F1F5F9]">
            {lines.map((l) => {
              const id = String(l.ingredientId);
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2">
                  <span className="flex-1 min-w-0 text-[13px] font-bold text-[#0F172A] truncate">{l.name}</span>
                  <input
                    className={`${boxClass} w-[110px] text-right ${values[id] !== "" ? "border-[#86EFAC] bg-[#F0FDF4]" : ""}`}
                    type="number" min="0" step="any" inputMode="decimal" placeholder="Count" data-scan="" data-line={id}
                    value={values[id]}
                    onChange={(e) => { dirty.current = true; setValues({ ...values, [id]: e.target.value }); }}
                    aria-label={`${l.name} counted`}
                  />
                  <span className="w-[46px] text-[12px] font-bold text-[#64748B]">{unitLabel(l.unit)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {groups.length === 0 && <p className={`${card} p-6 text-center text-[13px] text-[#94A3B8]`}>{onlyLeft ? "Everything is counted." : "No items match."}</p>}

      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-white/95 px-1 py-2 backdrop-blur">
        <button type="button" className={`${btnGhost} h-[40px]`} disabled={cancelMut.isPending}
          onClick={() => { if (window.confirm("Throw this count away? Nothing in stock changes.")) cancelMut.mutate(); }}>
          Cancel count
        </button>
        <button type="button" className={`${btnPrimary} flex-1`} disabled={!done || finishMut.isPending}
          onClick={() => { if (window.confirm(`Finish the count? The ${done} counted item(s) are set to what was counted.`)) finishMut.mutate(); }}>
          {finishMut.isPending ? "Finishing…" : `Finish count (${done})`}
        </button>
      </div>
    </div>
  );
};

/**
 * How soon a cancelled order puts its stock back (owner, 2026-11-03): within
 * this many minutes of being placed, what its sale took returns to the shelf;
 * later, the food is taken as made. 0 never puts it back.
 */
const CancelReturnSetting = () => {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["inventory", "settings"], queryFn: getInventorySettings });
  const saved = data?.data?.data?.cancelReturnMinutes;
  const [value, setValue] = useState(null);
  const shown = value ?? (saved === undefined ? "" : String(saved));
  const saveMut = useMutation({
    mutationFn: () => saveInventorySettings({ cancelReturnMinutes: Number(shown) }),
    onSuccess: () => { enqueueSnackbar("Saved", { variant: "success" }); setValue(null); qc.invalidateQueries({ queryKey: ["inventory"] }); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" }),
  });
  if (saved === undefined) return null;
  const n = Number(shown);
  const valid = shown !== "" && Number.isInteger(n) && n >= 0 && n <= 1440;
  return (
    <div className={`${card} p-4 space-y-2`}>
      <p className="text-[14px] font-extrabold text-[#0F172A]">Cancelled orders</p>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-[#475569]">
        Put the stock back when an order is cancelled within
        <input className={`${boxClass} h-[34px] w-[70px] text-right`} type="number" min="0" max="1440" step="1" inputMode="numeric"
          value={shown} onChange={(e) => setValue(e.target.value)} aria-label="Minutes after the order is placed" />
        minute(s) of placing it
        {shown !== String(saved) && (
          <button type="button" className={`${btnGhost} h-[34px]`} disabled={!valid || saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-[#94A3B8]">
        {n > 0
          ? `Cancelled later than ${n} minute(s), the food is taken as made and its stock stays used. Record anything thrown away under Waste.`
          : "0: a cancelled order never puts its stock back."}
      </p>
    </div>
  );
};

const CountTab = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "counts"], queryFn: getStockCounts });
  const counts = data?.data?.data || [];
  const [counting, setCounting] = useState(null); // count id
  const [viewing, setViewing] = useState(null); // a finished count
  const open = counts.find((c) => c.status === "open");

  const startMut = useMutation({
    mutationFn: startStockCount,
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["inventory", "counts"] }); setCounting(res.data.data._id); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not start a count", { variant: "error" }),
  });
  const viewMut = useMutation({ mutationFn: (id) => getStockCount(id), onSuccess: (res) => setViewing(res.data.data) });

  if (counting) return <Counting countId={counting} onBack={() => setCounting(null)} onDone={(c) => { setCounting(null); setViewing(c); }} />;
  if (viewing) return <Differences count={viewing} onBack={() => setViewing(null)} />;
  if (isLoading) return <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className={`${card} p-4 flex flex-col sm:flex-row sm:items-center gap-3`}>
        <div className="flex-1">
          <p className="text-[14px] font-extrabold text-[#0F172A]">{open ? `Stock count #${open.number} is open` : "Count the shelf"}</p>
          <p className="text-[12.5px] text-[#64748B]">
            {open
              ? `${open.totals.counted} of ${open.items} counted so far. Carry on from any phone.`
              : "Once a week works well. Count what is really there; the differences show what went missing, in ₹."}
          </p>
        </div>
        <button type="button" className={btnPrimary} disabled={startMut.isPending} onClick={() => (open ? setCounting(open._id) : startMut.mutate())}>
          {open ? "Continue counting" : startMut.isPending ? "Starting…" : "Start a stock count"}
        </button>
      </div>

      <CancelReturnSetting />

      {counts.filter((c) => c.status === "done").length > 0 && (
        <div className={card}>
          <p className="px-3 pt-3 pb-1 text-[12px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Past counts</p>
          <ul className="divide-y divide-[#F1F5F9]">
            {counts.filter((c) => c.status === "done").map((c) => (
              <li key={c._id}>
                <button type="button" className="w-full text-left px-3 py-2.5 hover:bg-[#F8FAFC]" onClick={() => viewMut.mutate(c._id)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-[13px] text-[#0F172A]">#{c.number} · {when(c.finishedAt)}</span>
                    <span className="text-[12.5px] font-bold tabular-nums">
                      <span className="text-[#B91C1C]">−{rupees(c.totals.missing)}</span>
                      {c.totals.extra > 0 && <span className="ml-2 text-[#15803D]">+{rupees(c.totals.extra)}</span>}
                    </span>
                  </div>
                  <span className="text-[11.5px] text-[#64748B]">{c.totals.counted} item(s) counted</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default CountTab;
