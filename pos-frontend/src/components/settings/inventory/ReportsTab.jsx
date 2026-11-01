import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInventoryReport } from "../../../https";
import { foodCostTone, qty, rupees, unitLabel } from "../../../utils/inventory";
import { card } from "./ui";

/**
 * Inventory reports (owner, 2026-11-01): stock value today; what was used,
 * wasted, bought and found missing in a period, in ₹; and the real food
 * cost: stock used against sales before tax.
 */

const istDay = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const PERIODS = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["month", "This month"],
  ["last", "Last month"],
];
const rangeOf = (key) => {
  const today = new Date();
  const [y, m] = istDay(today).split("-").map(Number);
  if (key === "month") return { from: `${y}-${String(m).padStart(2, "0")}-01`, to: istDay(today) };
  if (key === "last") {
    const first = new Date(Date.UTC(y, m - 2, 1));
    const last = new Date(Date.UTC(y, m - 1, 0));
    return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
  }
  const days = Number(key) || 30;
  return { from: istDay(new Date(today.getTime() - (days - 1) * 86400000)), to: istDay(today) };
};

const Stat = ({ label, value, tone = "text-[#0F172A]", note }) => (
  <div className={`${card} p-3`}>
    <span className="block text-[11.5px] font-bold text-[#64748B]">{label}</span>
    <span className={`block text-[20px] font-black tabular-nums ${tone}`}>{value}</span>
    {note && <span className="block text-[11px] text-[#94A3B8]">{note}</span>}
  </div>
);

const ReportsTab = () => {
  const [period, setPeriod] = useState("30");
  const range = useMemo(() => rangeOf(period), [period]);
  const [sort, setSort] = useState("usedValue");
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["inventory", "report", range.from, range.to],
    queryFn: () => getInventoryReport(range),
    placeholderData: (prev) => prev,
  });
  const r = data?.data?.data;
  const rows = useMemo(
    () => (r?.items || []).filter((i) => i.usedValue || i.wastedValue || i.boughtValue || i.countValue || i.used || i.wasted || i.bought || i.countDiff)
      .sort((a, b) => (sort === "countValue" ? a.countValue - b.countValue : b[sort] - a[sort])),
    [r, sort],
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        {PERIODS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setPeriod(k)}
            className={`h-[34px] rounded-full px-3 text-[12px] font-bold whitespace-nowrap ${period === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] text-[#334155]"}`}>
            {l}
          </button>
        ))}
        {isFetching && <span className="self-center text-[11.5px] text-[#94A3B8]">Updating…</span>}
      </div>

      {isLoading || !r ? (
        <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
            <Stat label="Stock value today" value={rupees(r.stockValue)} note="At today's cost prices" />
            <Stat
              label="Real food cost"
              value={r.foodCostPct === null ? "—" : `${r.foodCostPct}%`}
              tone={foodCostTone(r.foodCostPct, r.targetFoodCostPct)}
              note={r.foodCostPct === null ? "No sales in this period" : `Stock used ${rupees(r.used)} of sales ${rupees(r.sales)} (before tax) · target ${r.targetFoodCostPct}%. Products without a recipe use no stock here.`}
            />
            <Stat label="Stock used" value={rupees(r.used)} note="Taken by sales, through recipes" />
            <Stat label="Wastage" value={rupees(r.wasted)} tone={r.wasted > 0 ? "text-[#B45309]" : "text-[#0F172A]"} note="Recorded as wasted" />
            <Stat label="Bought" value={rupees(r.bought)} note="Stock added with a cost" />
            <Stat
              label="Count differences"
              value={`${r.countDifference < 0 ? "−" : r.countDifference > 0 ? "+" : ""}${rupees(Math.abs(r.countDifference))}`}
              tone={r.countDifference < 0 ? "text-[#B91C1C]" : r.countDifference > 0 ? "text-[#15803D]" : "text-[#0F172A]"}
              note="Stock counts and corrections"
            />
          </div>

          {r.noCostPrice?.length > 0 && (
            <p className="rounded-xl border border-[#FED7AA] bg-[#FFF7ED] p-3 text-[12px] text-[#9A3412]">
              <b>No cost price yet</b> for {r.noCostPrice.slice(0, 12).join(", ")}{r.noCostPrice.length > 12 ? ` and ${r.noCostPrice.length - 12} more` : ""}: they count as ₹0 here. Add stock with its cost, or set the cost price on the item.
            </p>
          )}

          <div className={`${card} overflow-hidden`}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
              <p className="text-[12px] font-extrabold uppercase tracking-wider text-[#94A3B8]">By item</p>
              <select className="h-[32px] rounded-lg border border-[#E2E8F0] px-2 text-[12px] font-bold" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
                <option value="usedValue">Most used</option>
                <option value="wastedValue">Most wasted</option>
                <option value="boughtValue">Most bought</option>
                <option value="countValue">Most missing</option>
              </select>
            </div>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-[13px] text-[#94A3B8]">Nothing moved in this period.</p>
            ) : (
              <>
                <ul className="md:hidden divide-y divide-[#F1F5F9] mt-2">
                  {rows.map((i) => {
                    const u = unitLabel(i.unit);
                    return (
                      <li key={i.ingredientId} className="px-3 py-2.5 text-[12.5px]">
                        <p className="font-bold text-[#0F172A]">{i.name}</p>
                        <p className="tabular-nums text-[#475569]">
                          {[
                            i.used ? `Used ${qty(i.used)} ${u} (${rupees(i.usedValue)})` : "",
                            i.wasted ? `Wasted ${qty(i.wasted)} ${u} (${rupees(i.wastedValue)})` : "",
                            i.bought ? `Bought ${qty(i.bought)} ${u} (${rupees(i.boughtValue)})` : "",
                            i.countDiff
                              ? `${i.countDiff < 0 ? "Missing" : "Extra"} ${qty(Math.abs(i.countDiff))} ${u} (${i.countDiff < 0 ? "−" : "+"}${rupees(Math.abs(i.countValue))})`
                              : "",
                          ].filter(Boolean).join(" · ")}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <table className="hidden md:table w-full text-[12.5px] mt-2">
                  <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Used</th>
                      <th className="px-3 py-2 text-right">Wasted</th>
                      <th className="px-3 py-2 text-right">Bought</th>
                      <th className="px-3 py-2 text-right">Count difference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {rows.map((i) => {
                      const u = unitLabel(i.unit);
                      const cell = (q, v, tone = "") =>
                        q ? (
                          <>
                            <span className={`font-bold ${tone}`}>{rupees(Math.abs(v))}</span>
                            <span className="block text-[11px] text-[#94A3B8]">{q > 0 && tone.includes("15803D") ? "+" : q < 0 ? "−" : ""}{qty(Math.abs(q))} {u}</span>
                          </>
                        ) : "—";
                      return (
                        <tr key={i.ingredientId}>
                          <td className="px-3 py-2 font-bold text-[#0F172A]">{i.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{cell(i.used, i.usedValue)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{cell(i.wasted, i.wastedValue, "text-[#B45309]")}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{cell(i.bought, i.boughtValue)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{cell(i.countDiff, i.countValue, i.countDiff < 0 ? "text-[#B91C1C]" : "text-[#15803D]")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ReportsTab;
