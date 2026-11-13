import React, { useEffect, useRef, useState } from "react";
import { localDay } from "../../utils";

/**
 * The period and store filters, in one row above the charts (Dashboard and
 * Orders). Days are the store's days (IST), as the POS reports count them.
 */

const DAY = 86400000;
const shift = (ymd, days) => localDay(new Date(new Date(`${ymd}T12:00:00+05:30`).getTime() + days * DAY));

export const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
  { key: "custom", label: "Custom" },
];

/** { from, to } (YYYY-MM-DD) for a period key; custom keeps its own dates. */
export const rangeFor = (key, custom = {}) => {
  const today = localDay();
  switch (key) {
    case "yesterday": {
      const y = shift(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: shift(today, -6), to: today };
    case "30d":
      return { from: shift(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "custom":
      return { from: custom.from || today, to: custom.to || custom.from || today };
    default:
      return { from: today, to: today };
  }
};

const chip = (on) =>
  `h-9 px-3.5 rounded-full text-[13px] font-bold border whitespace-nowrap transition-colors ${
    on ? "bg-[#0F172A] text-white border-[#0F172A]" : "bg-white text-[#334155] border-[#E2E8F0] hover:border-[#CBD5E1]"
  }`;

export const PeriodPicker = ({ period, onPeriod, custom, onCustom }) => (
  <div className="flex flex-col gap-2 min-w-0">
    <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-0.5" role="radiogroup" aria-label="Period">
      {PERIODS.map((p) => (
        <button key={p.key} type="button" role="radio" aria-checked={period === p.key} className={chip(period === p.key)} onClick={() => onPeriod(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
    {period === "custom" && (
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-bold text-[#334155]">
        <input type="date" max={localDay()} value={custom.from || ""} onChange={(e) => onCustom({ ...custom, from: e.target.value })} className="h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white" aria-label="From" />
        <span>to</span>
        <input type="date" max={localDay()} min={custom.from || undefined} value={custom.to || ""} onChange={(e) => onCustom({ ...custom, to: e.target.value })} className="h-9 px-2.5 rounded-lg border border-[#E2E8F0] bg-white" aria-label="To" />
      </div>
    )}
  </div>
);

/** All stores, or any set of them. `selected` empty = all. */
export const StoreFilter = ({ stores, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const usable = stores.filter((s) => s.linkStatus === "ok");
  const label = !selected.length || selected.length === usable.length ? `All stores (${usable.length})` : selected.length === 1 ? usable.find((s) => s.storeId === selected[0])?.name || "1 store" : `${selected.length} stores`;
  const toggle = (id) => {
    const base = selected.length ? selected : usable.map((s) => s.storeId);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    onChange(next.length === usable.length ? [] : next.length ? next : base);
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="h-9 px-3.5 rounded-full text-[13px] font-bold border border-[#E2E8F0] bg-white text-[#0F172A] max-w-[260px] truncate">
        {label} ▾
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(300px,calc(100vw-2rem))] bg-white border border-[#E2E8F0] rounded-xl shadow-xl p-2">
          <button type="button" className="w-full text-left px-3 h-10 rounded-lg text-[13px] font-bold text-[#C2410C] hover:bg-[#FFF7F2]" onClick={() => onChange([])}>
            All stores
          </button>
          <div className="max-h-[300px] overflow-y-auto">
            {usable.map((s) => {
              const on = !selected.length || selected.includes(s.storeId);
              return (
                <label key={s.storeId} className="flex items-center gap-3 px-3 min-h-[42px] rounded-lg hover:bg-[#F8FAFC] cursor-pointer">
                  <input type="checkbox" checked={on} onChange={() => toggle(s.storeId)} className="w-[18px] h-[18px] accent-[#FD5302]" />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-bold truncate">{s.name}</span>
                    <span className="block text-[11px] text-[#94A3B8]">Store {s.storeId}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/** One store at a time (Billing, Reports). */
export const StorePicker = ({ usable, current, onChoose, note }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-3 sm:p-4 flex flex-wrap items-center gap-3 mb-4">
    <label className="flex items-center gap-3 min-w-0 flex-1">
      <span className="text-[13px] font-bold text-[#64748B] shrink-0">Store</span>
      <select
        value={current?.storeId || ""}
        onChange={(e) => onChoose(e.target.value)}
        className="h-11 min-w-0 flex-1 max-w-[420px] px-3 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-bold text-[#0F172A]"
      >
        {usable.map((s) => (
          <option key={s.storeId} value={s.storeId}>
            {s.name} · {s.storeId}
            {s.locked ? " · locked" : ""}
          </option>
        ))}
      </select>
    </label>
    {note}
  </div>
);
