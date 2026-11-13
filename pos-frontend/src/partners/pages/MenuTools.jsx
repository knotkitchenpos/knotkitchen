import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MdContentCopy, MdSell, MdCheckCircle, MdSearch } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { inr } from "../../utils";
import { partnersApi, errorMessage } from "../api";

/**
 * Menu across stores (owner, 2026-11-13): copy categories from one store to
 * others, and change a dish's price in several stores at once. Both change
 * the stores' draft menus (pos-backend services/menuTools.js); "Publish now"
 * then sends them to the tills and websites, as Manage Menu's Publish does.
 */

const tabCls = (on) =>
  `h-10 px-4 rounded-xl text-[13.5px] font-extrabold inline-flex items-center gap-2 ${on ? "bg-[#0F172A] text-white" : "bg-white border border-[#E2E8F0] text-[#334155]"}`;
const btn = "h-11 px-5 rounded-xl bg-[#FD5302] text-white text-[14px] font-extrabold hover:bg-[#D64502] disabled:opacity-40";

/** After a change: send it to the tills (and websites) of those stores. */
const PublishNow = ({ storeIds, names, onDone }) => {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const publish = async () => {
    setBusy(true);
    const failed = [];
    for (const id of storeIds) {
      try {
        await partnersApi.publishMenu(id, "system");
      } catch (err) {
        failed.push(`${names.get(id) || id}: ${errorMessage(err, "not published")}`);
        continue;
      }
      // The website only where the store has one (its plan): a refusal there is no failure.
      await partnersApi.publishMenu(id, "website").catch(() => {});
    }
    setBusy(false);
    setDone(true);
    if (failed.length) enqueueSnackbar(failed.join(" · "), { variant: "error" });
    else enqueueSnackbar("Published to the tills and websites.", { variant: "success", important: true });
    onDone?.();
  };
  if (done) return <p className="text-[13px] font-bold text-[#15803D] inline-flex items-center gap-1.5"><MdCheckCircle size={17} /> Published.</p>;
  return (
    <div className="rounded-xl bg-[#FFFBEB] border border-[#FDE68A] p-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12.5px] text-[#92400E] font-bold">Saved to the draft menu. The tills and websites show it once published.</p>
      <button type="button" onClick={publish} disabled={busy} className="h-10 px-4 rounded-xl bg-[#0F172A] text-white text-[13px] font-extrabold disabled:opacity-40">
        {busy ? "Publishing…" : `Publish now (${storeIds.length} store${storeIds.length === 1 ? "" : "s"})`}
      </button>
    </div>
  );
};

const CopyMenu = ({ catalog, names, refresh }) => {
  const [from, setFrom] = useState(catalog[0]?.storeId || "");
  const [cats, setCats] = useState([]);
  const [to, setTo] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const source = catalog.find((s) => s.storeId === from);
  const toggle = (list, set, id) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const copy = async () => {
    setBusy(true);
    try {
      const res = await partnersApi.copyMenu({ from, to, categoryIds: cats });
      setResult(res.data.data.results);
      refresh();
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Could not copy."), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  if (catalog.length < 2) return <p className="text-[13px] text-[#64748B]">Link a second store to copy menus between them.</p>;
  return (
    <div className="space-y-4">
      <label className="block max-w-[420px]">
        <span className="text-[13px] font-bold text-[#64748B]">Copy from</span>
        <select value={from} onChange={(e) => { setFrom(e.target.value); setCats([]); setTo([]); setResult(null); }} className="mt-1.5 h-11 w-full px-3 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-bold">
          {catalog.map((s) => <option key={s.storeId} value={s.storeId}>{s.name} · {s.storeId}</option>)}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[#E2E8F0] bg-white">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#F1F5F9]">
            <p className="text-[13px] font-extrabold">Categories</p>
            <button type="button" className="text-[12px] font-bold text-[#C2410C]" onClick={() => setCats(cats.length === (source?.categories || []).length ? [] : (source?.categories || []).map((c) => c.id))}>
              {cats.length === (source?.categories || []).length ? "None" : "All"}
            </button>
          </div>
          <div className="max-h-[320px] overflow-y-auto divide-y divide-[#F1F5F9]">
            {(source?.categories || []).map((c) => (
              <label key={c.id} className="flex items-center gap-3 px-3 min-h-[46px] cursor-pointer">
                <input type="checkbox" checked={cats.includes(c.id)} onChange={() => toggle(cats, setCats, c.id)} className="w-[18px] h-[18px] accent-[#FD5302]" />
                <span className="min-w-0 flex-1 text-[13.5px] font-bold truncate">{c.name}</span>
                <span className="text-[12px] text-[#94A3B8] shrink-0">{c.items.length} dishes</span>
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-[#E2E8F0] bg-white">
          <p className="px-3 py-2.5 border-b border-[#F1F5F9] text-[13px] font-extrabold">Copy to</p>
          <div className="divide-y divide-[#F1F5F9]">
            {catalog.filter((s) => s.storeId !== from).map((s) => (
              <label key={s.storeId} className="flex items-center gap-3 px-3 min-h-[46px] cursor-pointer">
                <input type="checkbox" checked={to.includes(s.storeId)} onChange={() => toggle(to, setTo, s.storeId)} className="w-[18px] h-[18px] accent-[#FD5302]" />
                <span className="min-w-0 flex-1 text-[13.5px] font-bold truncate">{s.name}</span>
                <span className="text-[12px] text-[#94A3B8] shrink-0">{s.categories.length} categories</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[12px] text-[#64748B]">A category the store already has gets the dishes it lacks; nothing there is changed or removed. Recipes and stock links are not copied.</p>
      <button type="button" className={btn} disabled={busy || !cats.length || !to.length} onClick={copy}>
        {busy ? "Copying…" : `Copy ${cats.length || ""} categor${cats.length === 1 ? "y" : "ies"} to ${to.length || ""} store${to.length === 1 ? "" : "s"}`}
      </button>
      {result && (
        <div className="space-y-3">
          <ul className="text-[13px] space-y-1">
            {result.map((r) => (
              <li key={r.storeId}><strong>{names.get(r.storeId) || r.storeId}</strong>: {r.categoriesCreated} categor{r.categoriesCreated === 1 ? "y" : "ies"} created, {r.dishesAdded} dishes added{r.dishesSkipped ? `, ${r.dishesSkipped} already there` : ""}.</li>
            ))}
          </ul>
          <PublishNow storeIds={result.filter((r) => r.categoriesCreated || r.dishesAdded).map((r) => r.storeId)} names={names} />
        </div>
      )}
    </div>
  );
};

const ChangePrices = ({ catalog, names, refresh }) => {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(null); // dish name key
  const [rows, setRows] = useState({}); // occurrence key -> on
  const [price, setPrice] = useState("");
  const [variantPrice, setVariantPrice] = useState({});
  const [busy, setBusy] = useState(false);
  const [changedStores, setChangedStores] = useState(null);

  // Every dish name, with where it is.
  const dishes = useMemo(() => {
    const map = new Map();
    for (const s of catalog) for (const c of s.categories) for (const i of c.items) {
      const k = i.name.trim().toLowerCase();
      const d = map.get(k) || { key: k, name: i.name, places: [] };
      d.places.push({ key: `${s.storeId}:${i.id}`, storeId: s.storeId, store: s.name, menuId: c.id, category: c.name, item: i });
      map.set(k, d);
    }
    return [...map.values()].sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));
  }, [catalog]);
  const found = q.trim() ? dishes.filter((d) => d.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30) : dishes.filter((d) => d.places.length > 1).slice(0, 30);
  const dish = dishes.find((d) => d.key === picked);
  const variantNames = dish ? [...new Set(dish.places.flatMap((p) => p.item.variants.map((v) => v.name)))] : [];

  const choose = (d) => {
    setPicked(d.key);
    setRows(Object.fromEntries(d.places.map((p) => [p.key, true])));
    setPrice("");
    setVariantPrice({});
    setChangedStores(null);
  };
  const apply = async () => {
    const changes = dish.places
      .filter((p) => rows[p.key])
      .map((p) => ({
        storeId: p.storeId,
        menuId: p.menuId,
        itemId: p.item.id,
        ...(price !== "" ? { price: Number(price) } : {}),
        variants: p.item.variants.filter((v) => variantPrice[v.name] !== undefined && variantPrice[v.name] !== "").map((v) => ({ id: v.id, price: Number(variantPrice[v.name]) })),
      }));
    setBusy(true);
    try {
      const res = await partnersApi.setMenuPrices({ changes });
      const stores = res.data.data.results.filter((r) => r.changed).map((r) => r.storeId);
      setChangedStores(stores);
      enqueueSnackbar(`Price changed in ${stores.length} store(s).`, { variant: "success", important: true });
      refresh();
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Could not change the price."), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  const nothing = price === "" && !Object.values(variantPrice).some((v) => v !== "");

  return (
    <div className="space-y-4">
      <label className="relative block max-w-[480px]">
        <MdSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a dish, e.g. Butter Chicken" className="w-full h-11 pl-11 pr-3 rounded-xl border border-[#E2E8F0] bg-white text-[14px]" />
      </label>
      {!dish && (
        <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#F1F5F9]">
          {!q.trim() && <p className="px-3 py-2 text-[12px] text-[#94A3B8]">Dishes in more than one store:</p>}
          {found.length === 0 ? (
            <p className="px-3 py-4 text-[13px] text-[#94A3B8]">No dish found.</p>
          ) : (
            found.map((d) => (
              <button key={d.key} type="button" onClick={() => choose(d)} className="w-full text-left flex items-center justify-between gap-3 px-3 min-h-[48px] hover:bg-[#F8FAFC]">
                <span className="min-w-0 text-[13.5px] font-bold truncate">{d.name}</span>
                <span className="text-[12px] text-[#64748B] shrink-0">{d.places.length} store{d.places.length === 1 ? "" : "s"}</span>
              </button>
            ))
          )}
        </div>
      )}
      {dish && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[16px] font-extrabold truncate">{dish.name}</h3>
            <button type="button" className="text-[12.5px] font-bold text-[#C2410C]" onClick={() => setPicked(null)}>Change dish</button>
          </div>
          <div className="rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#F1F5F9]">
            {dish.places.map((p) => (
              <label key={p.key} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={Boolean(rows[p.key])} onChange={() => setRows({ ...rows, [p.key]: !rows[p.key] })} className="w-[18px] h-[18px] accent-[#FD5302]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold truncate">{p.store}</span>
                  <span className="block text-[11.5px] text-[#94A3B8] truncate">{p.category}{p.item.samePrice ? "" : " · has channel prices"}</span>
                </span>
                <span className="text-right text-[13px] font-extrabold shrink-0">
                  {inr(p.item.price)}
                  {p.item.variants.length > 0 && <span className="block text-[11px] font-semibold text-[#64748B]">{p.item.variants.map((v) => `${v.name} ${inr(v.price)}`).join(" · ")}</span>}
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 max-w-[560px]">
            <label className="block">
              <span className="text-[13px] font-bold text-[#334155]">New price</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Leave empty to keep" className="mt-1.5 h-11 w-full px-3 rounded-xl border border-[#E2E8F0] text-[15px] font-bold" />
            </label>
            {variantNames.map((v) => (
              <label key={v} className="block">
                <span className="text-[13px] font-bold text-[#334155]">{v}</span>
                <input type="number" min="0" step="0.5" inputMode="decimal" value={variantPrice[v] ?? ""} onChange={(e) => setVariantPrice({ ...variantPrice, [v]: e.target.value })} placeholder="Leave empty to keep" className="mt-1.5 h-11 w-full px-3 rounded-xl border border-[#E2E8F0] text-[15px] font-bold" />
              </label>
            ))}
          </div>
          <p className="text-[12px] text-[#64748B]">A dish with separate channel prices (website, delivery) keeps those; change them in that store&apos;s Manage Menu.</p>
          <button type="button" className={btn} disabled={busy || nothing || !Object.values(rows).some(Boolean)} onClick={apply}>
            {busy ? "Saving…" : `Change in ${Object.values(rows).filter(Boolean).length} store(s)`}
          </button>
          {changedStores?.length > 0 && <PublishNow storeIds={changedStores} names={names} />}
        </div>
      )}
    </div>
  );
};

const MenuTools = ({ me }) => {
  const [tab, setTab] = useState("copy");
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-menu-catalog"],
    queryFn: () => partnersApi.menuCatalog().then((r) => r.data.data),
  });
  const catalog = data?.stores || [];
  const names = new Map((me?.stores || []).map((s) => [s.storeId, s.name]));
  const refresh = () => qc.invalidateQueries({ queryKey: ["partner-menu-catalog"] });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Menu across stores</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Copy categories between stores, or change a dish&apos;s price everywhere at once.</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className={tabCls(tab === "copy")} onClick={() => setTab("copy")}><MdContentCopy size={17} /> Copy menu</button>
        <button type="button" className={tabCls(tab === "prices")} onClick={() => setTab("prices")}><MdSell size={17} /> Change prices</button>
      </div>
      <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
        {isError ? (
          <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load the menus.")}</p>
        ) : isLoading ? (
          <div className="h-32 animate-pulse rounded-xl bg-[#F1F5F9]" />
        ) : tab === "copy" ? (
          <CopyMenu catalog={catalog} names={names} refresh={refresh} />
        ) : (
          <ChangePrices catalog={catalog} names={names} refresh={refresh} />
        )}
      </section>
    </div>
  );
};

export default MenuTools;
