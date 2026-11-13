import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { thumbUrl } from "../../utils";
import { PHONE_COLUMNS, loadPhoneColumns, savePhoneColumns } from "../../utils/phoneLayout";
import { useHoldReorder } from "../../hooks/useHoldReorder";
import { loadSystemMenu, readSavedMenu, systemMenuKey } from "../../utils/systemMenu";

/**
 * Settings > Device Configuration: what the product screen of the POS shows.
 *   - Phone Screen Layout: products per row on a phone (this device, at once)
 *   - Popular Items: how many, which, in what order (the restaurant, on Save)
 */

const POPULAR_MIN = 2;
const POPULAR_MAX = 48;

const Card = ({ title, subtitle, children, right }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h4 className="text-[15px] font-extrabold text-[#0F172A]">{title}</h4>
        {subtitle ? <p className="text-[12px] text-[#64748B] mt-0.5">{subtitle}</p> : null}
      </div>
      {right}
    </div>
    <div className="mt-4">{children}</div>
  </div>
);

/** A row of `n` little product cards, to show what a layout looks like. */
const LayoutSketch = ({ n, on }) => (
  <div className="grid gap-[3px] w-full" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
    {Array.from({ length: n * 2 }, (_, i) => (
      <div key={i} className={`rounded-[3px] border ${on ? "border-[#FDBA8C] bg-white" : "border-[#E2E8F0] bg-white"}`}>
        <div className={`${n === 2 ? "aspect-[4/3]" : "aspect-square"} rounded-t-[2px] ${on ? "bg-[#FED7AA]" : "bg-[#E2E8F0]"}`} />
        <div className="h-[5px] m-[2px] rounded-sm bg-[#CBD5E1]" />
      </div>
    ))}
  </div>
);

export const PhoneLayoutCard = () => {
  const [cols, setCols] = useState(loadPhoneColumns);
  return (
    <Card
      title="Phone Screen Layout"
      subtitle="Products in each row on this phone. Tablets and computers keep their wider grid."
    >
      <div className="grid grid-cols-3 gap-2 sm:gap-3 max-w-[460px]" role="radiogroup" aria-label="Products per row on a phone">
        {PHONE_COLUMNS.map((n) => {
          const on = cols === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setCols(savePhoneColumns(n))}
              className={`min-w-0 flex flex-col rounded-xl border-2 p-2 sm:p-2.5 text-left transition-colors ${
                on ? "border-[#FD5302] bg-[#FFF7F2]" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
              }`}
            >
              <div className="flex-1 flex items-center w-full">
                <LayoutSketch n={n} on={on} />
              </div>
              <p className={`mt-2 text-[12.5px] sm:text-[13px] font-extrabold ${on ? "text-[#C2410C]" : "text-[#0F172A]"}`}>
                {n} per row
              </p>
              <p className="text-[10.5px] sm:text-[11px] text-[#94A3B8] leading-tight">
                {n === 2 ? "Large photos" : n === 3 ? "Balanced" : "Most items"}
              </p>
            </button>
          );
        })}
      </div>
      <p className="text-[11.5px] text-[#94A3B8] mt-3">Saved on this device straight away.</p>
    </Card>
  );
};

const IconGrip = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[5, 12, 19].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" />))}
  </svg>
);

const arrowBtn =
  "w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg border border-[#E2E8F0] text-[#475569] text-[14px] font-bold flex items-center justify-center hover:bg-[#F8FAFC] disabled:opacity-30";

/**
 * Popular Items: `form` holds popularCount, popularItemIds and popularFill,
 * saved with the screen's Save button like the receipt settings.
 */
export const PopularItemsCard = ({ form, patch }) => {
  // The published menu, as the tills show it: a dish not published yet could
  // be chosen here but would never appear on a till.
  const { data: menusRes, isLoading } = useQuery({
    queryKey: systemMenuKey(),
    queryFn: loadSystemMenu,
    initialData: () => {
      const saved = readSavedMenu();
      return saved?.body ? { data: saved.body } : undefined;
    },
    initialDataUpdatedAt: 0,
  });
  const dishes = useMemo(() => {
    const map = new Map();
    for (const m of menusRes?.data?.data || []) {
      for (const i of m.items || []) {
        if (i?._id && !map.has(String(i._id))) map.set(String(i._id), { ...i, categoryName: m.name });
      }
    }
    return map;
  }, [menusRes]);

  const ids = form.popularItemIds || [];
  const fill = form.popularFill !== false;
  const count = Math.max(Number(form.popularCount) || 12, ids.length);
  const minCount = Math.max(POPULAR_MIN, ids.length);

  const setIds = (next) => patch({ popularItemIds: next, popularCount: Math.max(count, next.length) });
  const toggle = (id) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(0, POPULAR_MAX));
  const move = (id, by) => {
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    setIds(next);
  };

  const { bind, dragId, order } = useHoldReorder({ ids, onDrop: setIds });

  // What is being typed in the count box: applied (and kept in range) on
  // leaving it or Enter, so typing "12" never stops at a clamped "1".
  const [draft, setDraft] = useState(null);
  const applyDraft = () => {
    if (draft == null) return;
    const n = Math.round(Number(draft));
    if (draft.trim() !== "" && Number.isFinite(n)) patch({ popularCount: Math.min(POPULAR_MAX, Math.max(minCount, n)) });
    setDraft(null);
  };
  const shown = order || ids;

  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = [...dishes.values()];
    return s ? all.filter((d) => d.name?.toLowerCase().includes(s) || d.categoryName?.toLowerCase().includes(s)) : all;
  }, [dishes, q]);

  const missing = ids.filter((id) => !dishes.has(id)).length;
  const onlyPinned = !fill && ids.length > 0;

  return (
    <Card
      title="Popular Items"
      subtitle="The first screen of the POS on every device of this restaurant."
      right={
        <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full bg-[#FFF1E8] text-[#C2410C] shrink-0">
          {onlyPinned ? ids.length : count} shown
        </span>
      }
    >
      {/* How many */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-[#0F172A]">Items to show</p>
          <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
            {onlyPinned ? "Only your chosen items are shown." : `Between ${minCount} and ${POPULAR_MAX}.`}
          </p>
        </div>
        <div className={`flex items-center gap-2 ${onlyPinned ? "opacity-40 pointer-events-none" : ""}`}>
          <button
            type="button"
            className={arrowBtn}
            aria-label="Show fewer"
            disabled={count <= minCount}
            onClick={() => patch({ popularCount: Math.max(minCount, count - 1) })}
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            aria-label="Popular items to show"
            min={minCount}
            max={POPULAR_MAX}
            value={draft ?? count}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={applyDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyDraft();
              }
            }}
            className="w-14 h-9 rounded-lg border border-[#E2E8F0] text-center text-[14px] font-extrabold text-[#0F172A]"
          />
          <button
            type="button"
            className={arrowBtn}
            aria-label="Show more"
            disabled={count >= POPULAR_MAX}
            onClick={() => patch({ popularCount: Math.min(POPULAR_MAX, count + 1) })}
          >
            +
          </button>
        </div>
      </div>

      {/* Which, in what order */}
      <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-[#0F172A]">Chosen items ({ids.length})</p>
            <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
              {ids.length
                ? "Shown first, in this order. Hold an item and drag it, or use the arrows."
                : "None chosen: the best sellers of the last 30 days are shown."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            className="h-9 px-3.5 rounded-lg border border-[#FDBA8C] bg-[#FFF1E8] text-[12.5px] font-bold text-[#C2410C] hover:bg-[#FFE4D1] shrink-0"
            aria-expanded={picking}
          >
            {picking ? "Done" : "Choose items"}
          </button>
        </div>

        {picking && (
          <div className="mt-3 rounded-xl border border-[#E2E8F0] overflow-hidden">
            <div className="p-2 border-b border-[#E2E8F0] bg-[#F8FAFC]">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search product or category…"
                aria-label="Search products"
                className="w-full h-9 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[13px]"
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto divide-y divide-[#F1F5F9]">
              {isLoading ? (
                <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">Loading menu…</p>
              ) : matches.length === 0 ? (
                <p className="p-4 text-center text-[12.5px] text-[#94A3B8]">No products match.</p>
              ) : (
                matches.map((d) => {
                  const id = String(d._id);
                  const on = ids.includes(id);
                  const full = !on && ids.length >= POPULAR_MAX;
                  return (
                    <label
                      key={id}
                      className={`flex items-center gap-3 px-3 min-h-[48px] ${full ? "opacity-40" : "cursor-pointer hover:bg-[#F8FAFC]"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={full}
                        onChange={() => toggle(id)}
                        className="w-[18px] h-[18px] accent-[#FD5302] shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold text-[#0F172A] truncate">{d.name}</span>
                        <span className="block text-[11px] text-[#94A3B8] truncate">{d.categoryName}</span>
                      </span>
                      {on && <span className="text-[11px] font-extrabold text-[#C2410C] shrink-0">#{ids.indexOf(id) + 1}</span>}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
        {missing > 0 && (
          <p className="mt-2 text-[11.5px] text-[#B45309]">
            {missing} chosen item(s) are no longer on the menu and are skipped.
          </p>
        )}

        {shown.length > 0 && (
          <ol className="mt-3 space-y-1.5 select-none" aria-label="Chosen popular items">
            {shown.map((id, idx) => {
              const d = dishes.get(id);
              const img = d && (d.imageThumbnailUrl || d.imageUrl || d.image);
              return (
                <li
                  key={id}
                  {...bind(id)}
                  className={`flex items-center gap-1.5 sm:gap-2 rounded-xl border bg-white p-1.5 sm:pr-2 touch-pan-y ${
                    dragId === id ? "border-[#FD5302] shadow-lg scale-[1.01] relative z-10" : "border-[#E2E8F0]"
                  }`}
                >
                  <span className="w-6 shrink-0 flex flex-col items-center text-[#94A3B8] cursor-grab" title="Hold and drag to move">
                    <IconGrip />
                    <span className="text-[10.5px] font-extrabold text-[#64748B]">{idx + 1}</span>
                  </span>
                  <span className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg overflow-hidden bg-[#F1F5F9] shrink-0 flex items-center justify-center">
                    {img ? <img src={thumbUrl(img, 120)} alt="" className="w-full h-full object-cover" draggable={false} /> : "🍽️"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-[#0F172A] leading-tight line-clamp-2 break-words">{d?.name || "Not on the menu"}</span>
                    <span className="block text-[11px] text-[#94A3B8] truncate">{d?.categoryName || "Skipped on the till"}</span>
                  </span>
                  <button type="button" className={arrowBtn} aria-label={`Move ${d?.name || "item"} up`} disabled={idx === 0} onClick={() => move(id, -1)}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className={arrowBtn}
                    aria-label={`Move ${d?.name || "item"} down`}
                    disabled={idx === shown.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${arrowBtn} text-[#DC2626] hover:bg-[#FEF2F2]`}
                    aria-label={`Remove ${d?.name || "item"}`}
                    onClick={() => toggle(id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
        )}

      </div>

      {/* The rest */}
      {ids.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[#E2E8F0] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-bold text-[#0F172A]">Fill with best sellers</p>
            <p className="text-[11.5px] text-[#94A3B8] mt-0.5">
              {fill ? `Best sellers fill the places after your ${ids.length} chosen item(s).` : "Off: only your chosen items are shown."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={fill}
            aria-label="Fill with best sellers"
            onClick={() => patch({ popularFill: !fill })}
            className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${fill ? "bg-[#FD5302]" : "bg-[#CBD5E1]"}`}
          >
            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${fill ? "translate-x-5" : ""}`} />
          </button>
        </div>
      )}
      <p className="text-[11.5px] text-[#94A3B8] mt-3">Saved for the whole restaurant with Save below.</p>
    </Card>
  );
};
