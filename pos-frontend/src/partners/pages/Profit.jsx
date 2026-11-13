import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { partnersApi, errorMessage } from "../api";
import { inr } from "../../utils";
import { PeriodPicker, StoreFilter, rangeFor } from "../components/Filters";
import { StatTile, Card } from "../components/charts";

/**
 * Profit (owner, 2026-11-13): sales against what the dishes cost to make,
 * per store and dish (pos-backend services/profit.js). Costs come from each
 * dish's recipe in Inventory; a dish without one is shown apart, never
 * guessed.
 */

const pctCls = (pct, target) => (pct == null ? "text-[#94A3B8]" : pct > target ? "text-[#B91C1C]" : "text-[#15803D]");

const DishRow = ({ d, target }) => (
  <tr className="border-t border-[#F1F5F9]">
    <td className="py-2 pr-2">
      <span className="block font-bold">{d.name}</span>
      <span className="block text-[11px] text-[#94A3B8]">{d.category || "—"}</span>
    </td>
    <td className="py-2 px-2 text-right">{d.quantity}</td>
    <td className="py-2 px-2 text-right">{inr(d.revenue)}</td>
    <td className="py-2 px-2 text-right">{d.hasRecipe ? inr(d.costPerPlate) : "—"}</td>
    <td className="py-2 px-2 text-right font-extrabold">{d.hasRecipe ? inr(d.profit) : <span className="text-[11.5px] font-bold text-[#B45309]">No recipe</span>}</td>
    <td className={`py-2 pl-2 text-right font-bold ${pctCls(d.foodCostPct, target)}`}>{d.foodCostPct == null ? "—" : `${d.foodCostPct}%`}</td>
  </tr>
);

const Profit = ({ me }) => {
  const [period, setPeriod] = useState("30d");
  const [custom, setCustom] = useState({});
  const [stores, setStores] = useState([]);
  const params = { ...rangeFor(period, custom), ...(stores.length ? { stores: stores.join(",") } : {}) };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-profit", params],
    queryFn: () => partnersApi.profit(params).then((r) => r.data.data),
  });
  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Profit</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">What the dishes sold for against what they cost to make, from their recipes in Inventory.</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        <StoreFilter stores={me?.stores || []} selected={stores} onChange={setStores} />
      </div>
      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not work out the profit.")}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile label="Food sales" value={inr(t.revenue)} hint="Bill lines, before discounts and GST" />
            <StatTile label="Food cost" value={inr(t.foodCost)} hint={`Of ${inr(t.costedRevenue)} with recipes`} />
            <StatTile label="Gross profit" value={inr(t.grossProfit)} hint="On dishes with recipes" />
            <StatTile label="Food cost %" value={t.foodCostPct == null ? "—" : `${t.foodCostPct}%`} hint={`${t.coveragePct}% of sales costed`} />
          </div>
          {t.coveragePct < 80 && (
            <p className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] px-3.5 py-2.5 text-[12.5px] font-bold text-[#92400E]">
              Only {t.coveragePct}% of food sales have a recipe, so the profit covers only those. Add recipes in{" "}
              <Link to="/inventory?tab=recipes" className="underline">Inventory</Link> to cost the rest.
            </p>
          )}
          {t.discounts > 0 && <p className="text-[12.5px] text-[#64748B]">Order discounts in this period: {inr(t.discounts)} (not taken off the dish figures).</p>}
          {data.stores.map((s) => (
            <Card
              key={s.storeId}
              title={s.name}
              subtitle={`Gross profit ${inr(s.grossProfit)} · food cost ${s.foodCostPct == null ? "—" : `${s.foodCostPct}%`} (target ${s.targetPct}%) · ${s.coveragePct}% costed`}
            >
              {s.dishes.length === 0 ? (
                <p className="text-[13px] text-[#94A3B8]">No sales in this period.</p>
              ) : (
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full min-w-[560px] text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-[#64748B]">
                        <th className="py-1.5 pr-2 font-bold">Dish</th>
                        <th className="py-1.5 px-2 font-bold text-right">Sold</th>
                        <th className="py-1.5 px-2 font-bold text-right">Sales</th>
                        <th className="py-1.5 px-2 font-bold text-right">Cost / plate</th>
                        <th className="py-1.5 px-2 font-bold text-right">Profit</th>
                        <th className="py-1.5 pl-2 font-bold text-right">Food cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.dishes.slice(0, 40).map((d) => (
                        <DishRow key={d.name} d={d} target={s.targetPct} />
                      ))}
                    </tbody>
                  </table>
                  {s.dishes.length > 40 && <p className="mt-2 text-[12px] text-[#94A3B8]">Top 40 of {s.dishes.length} dishes by profit.</p>}
                </div>
              )}
            </Card>
          ))}
        </>
      )}
    </div>
  );
};

export default Profit;
