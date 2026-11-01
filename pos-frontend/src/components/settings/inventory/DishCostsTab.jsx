import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../../utils/notify";
import { getDishCosts, saveInventorySettings } from "../../../https";
import { foodCostTone, rupees } from "../../../utils/inventory";
import { boxClass, btnGhost, card, inputClass } from "./ui";

/**
 * Cost and profit per dish (owner, 2026-11-01): what one plate costs at
 * today's cost prices, what it sells for, the profit and the food cost %.
 * Above the store's target is flagged; the worst come first.
 */
const DishCostsTab = ({ onEditRecipe }) => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "dish-costs"], queryFn: getDishCosts });
  const rows = data?.data?.data || [];
  const target = data?.data?.settings?.targetFoodCostPct ?? 35;
  const [show, setShow] = useState("costed"); // costed | flagged | none
  const [search, setSearch] = useState("");
  const [editTarget, setEditTarget] = useState(null);

  const targetMut = useMutation({
    mutationFn: () => saveInventorySettings({ targetFoodCostPct: Number(editTarget) }),
    onSuccess: () => { setEditTarget(null); qc.invalidateQueries({ queryKey: ["inventory"] }); },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save the target", { variant: "error" }),
  });

  const costed = rows.filter((r) => r.hasRecipe);
  const flagged = costed.filter((r) => r.flag);
  const list = (show === "none" ? rows.filter((r) => !r.hasRecipe) : show === "flagged" ? flagged : costed)
    .filter((r) => `${r.name} ${r.category}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => (b.foodCostPct ?? -1) - (a.foodCostPct ?? -1));
  const avg = costed.filter((r) => r.foodCostPct !== null && r.price > 0);
  const avgPct = avg.length ? Math.round((avg.reduce((n, r) => n + r.foodCostPct, 0) / avg.length) * 10) / 10 : null;

  if (isLoading) return <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>;

  const Pill = ({ k, label, n }) => (
    <button
      type="button"
      onClick={() => setShow(k)}
      className={`h-[34px] rounded-full px-3 text-[12px] font-bold whitespace-nowrap ${show === k ? "bg-[#0F172A] text-white" : "border border-[#E2E8F0] text-[#334155]"}`}
    >
      {label} ({n})
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className={`${card} p-3`}>
          <span className="block text-[11.5px] font-bold text-[#64748B]">Products costed</span>
          <span className="block text-[22px] font-black tabular-nums">{costed.length}<span className="text-[13px] text-[#94A3B8]"> / {rows.length}</span></span>
        </div>
        <div className={`${card} p-3`}>
          <span className="block text-[11.5px] font-bold text-[#64748B]">Average food cost</span>
          <span className={`block text-[22px] font-black tabular-nums ${foodCostTone(avgPct, target)}`}>{avgPct === null ? "—" : `${avgPct}%`}</span>
        </div>
        <div className={`${card} p-3`}>
          <span className="block text-[11.5px] font-bold text-[#64748B]">Above target</span>
          <span className={`block text-[22px] font-black tabular-nums ${flagged.length ? "text-[#B91C1C]" : "text-[#15803D]"}`}>{flagged.length}</span>
        </div>
        <div className={`${card} p-3`}>
          <span className="block text-[11.5px] font-bold text-[#64748B]">Target food cost</span>
          {editTarget === null ? (
            <button type="button" className="block text-[22px] font-black tabular-nums text-[#0F172A] hover:text-[#C2410C]" onClick={() => setEditTarget(String(target))} title="Change the target">
              {target}% <span className="text-[11px] font-bold text-[#C2410C] align-middle">Edit</span>
            </button>
          ) : (
            <div className="mt-1 flex items-center gap-1.5">
              <input className={`${boxClass} h-[34px] w-[70px]`} type="number" min="1" max="100" value={editTarget} onChange={(e) => setEditTarget(e.target.value)} autoFocus />
              <button type="button" className={`${btnGhost} h-[34px]`} disabled={targetMut.isPending || !(Number(editTarget) >= 1)} onClick={() => targetMut.mutate()}>Save</button>
            </div>
          )}
        </div>
      </div>

      <p className="text-[12px] text-[#64748B]">
        Cost per plate is the recipe at today&apos;s cost prices (set by each stock purchase). Most restaurants aim for a food cost of 28–35%.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 overflow-x-auto">
          <Pill k="costed" label="With recipe" n={costed.length} />
          <Pill k="flagged" label="Above target" n={flagged.length} />
          <Pill k="none" label="No recipe" n={rows.length - costed.length} />
        </div>
        <input className={`${inputClass} font-medium sm:ml-auto sm:max-w-[260px]`} placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {list.length === 0 ? (
        <p className={`${card} p-6 text-center text-[13px] text-[#94A3B8]`}>
          {show === "none" ? "Every product has a recipe." : costed.length === 0 ? "No product has a recipe yet. Add one in Recipes, or in Manage Menu under the product's price." : "Nothing here."}
        </p>
      ) : (
        <>
          {/* Phones: one card per product. */}
          <ul className="md:hidden space-y-2">
            {list.map((r) => (
              <li key={r.menuItemId} className={`${card} p-3 ${r.flag ? "border-[#FECACA]" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-[14px] text-[#0F172A] truncate">{r.name}</p>
                    <p className="text-[11px] text-[#94A3B8]">{r.category}</p>
                  </div>
                  {r.hasRecipe && <span className={`text-[18px] font-black tabular-nums ${foodCostTone(r.foodCostPct, target)}`}>{r.foodCostPct === null ? "—" : `${r.foodCostPct}%`}</span>}
                </div>
                {r.hasRecipe ? (
                  <p className="mt-1.5 text-[12.5px] tabular-nums text-[#334155]">
                    Costs <b>{rupees(r.cost)}</b> · sells {rupees(r.price)} · profit <b className={r.profit < 0 ? "text-[#B91C1C]" : ""}>{rupees(r.profit)}</b>
                  </p>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-[#94A3B8]">Sells {rupees(r.price)} · no recipe</p>
                )}
                {r.missing?.length > 0 && <p className="mt-1 text-[11px] text-[#B45309]">No cost price: {r.missing.join(", ")}</p>}
                <button type="button" className="mt-2 text-[12px] font-bold text-[#C2410C]" onClick={() => onEditRecipe(r.menuItemId)}>
                  {r.hasRecipe ? "Edit recipe" : "Add recipe"}
                </button>
              </li>
            ))}
          </ul>
          <div className={`hidden md:block ${card} overflow-x-auto`}>
            <table className="w-full text-[12.5px]">
              <thead className="bg-[#F8FAFC] text-[11px] uppercase tracking-wide text-[#94A3B8]">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Cost per plate</th>
                  <th className="px-3 py-2 text-right">Selling price</th>
                  <th className="px-3 py-2 text-right">Profit</th>
                  <th className="px-3 py-2 text-right">Food cost</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {list.map((r) => (
                  <tr key={r.menuItemId} className={r.flag ? "bg-[#FEF2F2]" : ""}>
                    <td className="px-3 py-2">
                      <span className="font-bold text-[#0F172A]">{r.name}</span>
                      <span className="block text-[11px] text-[#94A3B8]">
                        {r.category}
                        {r.missing?.length > 0 && <span className="text-[#B45309]"> · no cost price: {r.missing.join(", ")}</span>}
                        {r.hasRecipe && !r.recipeOn && " · recipe off"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{r.hasRecipe ? rupees(r.cost) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{rupees(r.price)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${r.profit < 0 ? "text-[#B91C1C]" : ""}`}>{r.hasRecipe ? rupees(r.profit) : "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-black ${foodCostTone(r.foodCostPct, target)}`}>
                      {r.hasRecipe && r.foodCostPct !== null ? `${r.foodCostPct}%` : "—"}
                      {r.flag && <span className="ml-1 rounded-full bg-[#FEE2E2] px-1.5 py-0.5 text-[10px] font-bold text-[#991B1B]">High</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-[12px] font-bold text-[#C2410C] whitespace-nowrap" onClick={() => onEditRecipe(r.menuItemId)}>
                        {r.hasRecipe ? "Edit recipe" : "Add recipe"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default DishCostsTab;
