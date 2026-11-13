import React, { useState } from "react";
import { inr } from "../../utils";

/**
 * Small charts for the Partners dashboard, one brand hue each (magnitude, a
 * single series: no legend, the card title names it). Every bar has a hover
 * and tap tooltip; the numbers are also listed (BarList) so nothing is
 * colour-or-hover only.
 */

const ACCENT = "#FD5302";
const ACCENT_SOFT = "#FED7C3";

/** Vertical bars over time or hour. rows: [{ key, label, value, sub }] */
export const ColumnChart = ({ rows, height = 180, format = inr, emptyText = "No sales in this period." }) => {
  const [hover, setHover] = useState(null);
  if (!rows?.length) return <p className="py-10 text-center text-[13px] text-[#94A3B8]">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  const active = hover != null ? rows[hover] : null;
  // Label every bar when few, else about six evenly.
  const step = rows.length <= 8 ? 1 : Math.ceil(rows.length / 6);
  return (
    <div className="relative select-none">
      <div className="h-6 text-[12px] font-bold text-[#334155]" aria-live="polite">
        {active ? (
          <span>
            {active.label}: <span className="text-[#0F172A]">{format(active.value)}</span>
            {active.sub ? <span className="text-[#64748B] font-semibold"> · {active.sub}</span> : null}
          </span>
        ) : (
          <span className="text-[#94A3B8] font-semibold">Hover or tap a bar</span>
        )}
      </div>
      <div className="flex items-end gap-[2px] border-b border-[#E2E8F0]" style={{ height }} onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className="flex-1 h-full flex items-end min-w-0 focus:outline-none"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onClick={() => setHover(i)}
            aria-label={`${r.label}: ${format(r.value)}`}
          >
            <span
              className="block w-full rounded-t-[4px] transition-colors"
              style={{ height: `${Math.max(2, (r.value / max) * 100)}%`, background: hover === i ? ACCENT : hover == null ? ACCENT : ACCENT_SOFT }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1.5">
        {rows.map((r, i) => (
          <span key={r.key} className="flex-1 min-w-0 flex justify-center overflow-visible whitespace-nowrap text-[10.5px] text-[#94A3B8] font-semibold">
            {i % step === 0 ? r.short || r.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
};

/** Ranked horizontal bars with the value and share written out. rows: [{ key, label, value, count }] */
export const BarList = ({ rows, format = inr, countLabel = "orders", emptyText = "Nothing yet." }) => {
  if (!rows?.length) return <p className="py-6 text-center text-[13px] text-[#94A3B8]">{emptyText}</p>;
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0) || 1;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key} title={`${r.label}: ${format(r.value)}${r.count != null ? ` · ${r.count} ${countLabel}` : ""}`}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-bold text-[#0F172A] truncate">{r.label}</span>
            <span className="shrink-0 font-extrabold text-[#0F172A]">
              {format(r.value)}
              <span className="ml-1.5 text-[11.5px] font-semibold text-[#94A3B8]">{Math.round((r.value / total) * 100)}%</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-[#F1F5F9] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: ACCENT }} />
          </div>
          {r.count != null && <p className="mt-1 text-[11.5px] text-[#94A3B8]">{r.count} {countLabel}</p>}
        </li>
      ))}
    </ul>
  );
};

/** A headline number with its change against the period before. */
export const StatTile = ({ label, value, change, hint }) => {
  const up = change != null && change > 0;
  const down = change != null && change < 0;
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 min-w-0">
      <p className="text-[12px] font-bold uppercase tracking-wide text-[#64748B]">{label}</p>
      <p className="mt-1.5 text-[20px] sm:text-[24px] 2xl:text-[26px] font-extrabold text-[#0F172A] leading-tight break-words">{value}</p>
      <p className="mt-1 text-[12px] font-bold">
        {change == null ? (
          <span className="text-[#94A3B8]">{hint || "No earlier period to compare"}</span>
        ) : (
          <span className={up ? "text-[#15803D]" : down ? "text-[#B91C1C]" : "text-[#64748B]"}>
            {up ? "▲" : down ? "▼" : "•"} {Math.abs(change)}%<span className="text-[#94A3B8] font-semibold"> vs before</span>
          </span>
        )}
      </p>
    </div>
  );
};

export const Card = ({ title, subtitle, right, children, className = "" }) => (
  <section className={`bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 min-w-0 ${className}`}>
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-extrabold text-[#0F172A]">{title}</h2>
        {subtitle ? <p className="text-[12px] text-[#64748B] mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
    {children}
  </section>
);
