import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enqueueSnackbar } from "../../../utils/notify";
import { getAddonRecipes, saveAddonRecipe } from "../../../https";
import { rupees } from "../../../utils/inventory";
import { LinesEditor, btnGhost, btnPrimary, card, cleanLines, inputClass, toRows } from "./ui";

/**
 * Add-ons and sizes that use stock (owner, 2026-11-01). Extra Cheese takes
 * 30 g of cheese, Large takes another half a dough: each sale of the dish
 * with that choice takes it off the shelf on top of the dish's own recipe.
 */
const AddonsTab = ({ ingredients }) => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["inventory", "addon-recipes"], queryFn: getAddonRecipes });
  const options = useMemo(() => data?.data?.data?.options || [], [data]);
  const variants = useMemo(() => data?.data?.data?.variants || [], [data]);
  const [picked, setPicked] = useState(null); // the add-on being edited
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  const keyOf = (a) => (a.kind === "option" ? `o:${a.groupName}:${a.optionName}` : `v:${a.menuItemId}:${a.variantName}`);
  const pick = (a) => { setPicked(a); setRows(toRows(a.ingredients, ingredients)); };
  const saveMut = useMutation({
    mutationFn: (lines) => saveAddonRecipe({
      kind: picked.kind, groupName: picked.groupName, optionName: picked.optionName,
      menuItemId: picked.menuItemId, variantName: picked.variantName, ingredients: lines,
    }),
    onSuccess: (_, lines) => {
      enqueueSnackbar(lines.length ? "Saved" : "Removed", { variant: "success" });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      if (!lines.length) setRows(toRows([], ingredients));
    },
    onError: (e) => enqueueSnackbar(e.response?.data?.message || "Could not save", { variant: "error" }),
  });

  const match = (s) => s.toLowerCase().includes(search.trim().toLowerCase());
  const groups = useMemo(() => {
    const m = new Map();
    for (const o of options) {
      if (!m.has(o.groupName)) m.set(o.groupName, []);
      m.get(o.groupName).push(o);
    }
    return [...m.entries()];
  }, [options]);
  const sizes = useMemo(() => {
    const m = new Map();
    for (const v of variants) {
      if (!m.has(v.productName)) m.set(v.productName, []);
      m.get(v.productName).push(v);
    }
    return [...m.entries()];
  }, [variants]);

  if (isLoading) return <p className="p-6 text-center text-[13px] text-[#94A3B8]">Loading…</p>;
  if (!options.length && !variants.length) {
    return (
      <p className={`${card} p-6 text-center text-[13px] text-[#94A3B8]`}>
        No add-ons or sizes yet. Add groups (Extra Toppings…) or sizes to products in Manage Menu, then set what each uses here.
      </p>
    );
  }

  const Row = ({ a, label, sub }) => (
    <button
      type="button"
      onClick={() => pick(a)}
      className={`w-full text-left px-2 py-2 hover:bg-[#F8FAFC] ${picked && keyOf(picked) === keyOf(a) ? "bg-[#FFF1E8]" : ""}`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-[#0F172A] truncate">{label}</span>
        {a.ingredients.length > 0 && a.cost > 0 && <span className="text-[11.5px] font-bold tabular-nums text-[#334155]">{rupees(a.cost)}</span>}
      </span>
      <span className="block text-[11px] text-[#94A3B8]">{sub} · {a.ingredients.length ? `${a.ingredients.length} item(s)` : "uses no stock"}</span>
    </button>
  );

  return (
    // Phones show one side at a time, like Recipes.
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <div className={`md:col-span-2 ${card} p-3 ${picked ? "hidden md:block" : ""}`}>
        <input className={`${inputClass} mb-2 font-medium`} placeholder="Search add-ons and sizes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-[60dvh] md:max-h-[460px] overflow-y-auto">
          {groups.map(([group, list]) => {
            const shown = list.filter((o) => match(`${group} ${o.optionName}`));
            if (!shown.length) return null;
            return (
              <div key={group} className="mb-2">
                <p className="px-2 pt-2 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider text-[#94A3B8]">{group}</p>
                <div className="divide-y divide-[#F1F5F9]">
                  {shown.map((o) => <Row key={keyOf(o)} a={o} label={o.optionName} sub={o.price ? `+${rupees(o.price)}` : "free"} />)}
                </div>
              </div>
            );
          })}
          {sizes.map(([product, list]) => {
            const shown = list.filter((v) => match(`${product} ${v.variantName}`));
            if (!shown.length) return null;
            return (
              <div key={product} className="mb-2">
                <p className="px-2 pt-2 pb-1 text-[10.5px] font-extrabold uppercase tracking-wider text-[#94A3B8]">Sizes · {product}</p>
                <div className="divide-y divide-[#F1F5F9]">
                  {shown.map((v) => <Row key={keyOf(v)} a={v} label={v.variantName} sub={rupees(v.price)} />)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className={`md:col-span-3 ${card} p-4 ${picked ? "" : "hidden md:block"}`}>
        {picked && (
          <button type="button" className="md:hidden mb-2 text-[12.5px] font-bold text-[#C2410C]" onClick={() => setPicked(null)}>
            ← All add-ons
          </button>
        )}
        {!picked ? (
          <p className="text-[13px] text-[#94A3B8]">
            Pick an add-on or a size to set what one portion uses on top of the dish&apos;s own recipe. A pizza ordered with Extra Cheese then takes the dough and the extra cheese.
          </p>
        ) : ingredients.length === 0 ? (
          <p className="text-[13px] text-[#94A3B8]">Add inventory items on the Dashboard first.</p>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[13px] font-extrabold text-[#0F172A]">
                {picked.kind === "option" ? `${picked.optionName}` : `${picked.productName} · ${picked.variantName}`}
              </p>
              <p className="text-[11.5px] text-[#64748B]">
                {picked.kind === "option" ? `In ${picked.groupName}, for every product it is on.` : "Extra for this size, on top of the product's recipe."} One portion uses:
              </p>
            </div>
            <LinesEditor ingredients={ingredients} rows={rows} setRows={setRows} costLabel="Cost per portion" />
            <div className="flex gap-2 pt-1">
              {([...options, ...variants].find((a) => keyOf(a) === keyOf(picked)) || picked).ingredients.length > 0 && (
                <button type="button" className={`${btnGhost} h-[40px] flex-1 sm:flex-none`} disabled={saveMut.isPending} onClick={() => saveMut.mutate([])}>
                  Uses no stock
                </button>
              )}
              <button type="button" className={`${btnPrimary} flex-1 sm:flex-none`} disabled={saveMut.isPending} onClick={() => saveMut.mutate(cleanLines(rows, ingredients))}>
                {saveMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AddonsTab;
