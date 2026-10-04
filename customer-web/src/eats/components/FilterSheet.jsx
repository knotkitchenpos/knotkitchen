import React, { useEffect, useRef, useState } from "react";
import useScrollLock from "../../lib/useScrollLock";
import { COST_BUCKETS, DEFAULT_FILTERS, RATINGS, SORTS } from "../../lib/eatsFilters";
import { BTN_PRIMARY, BTN_SECONDARY, FOCUS } from "../shared";

/**
 * Sort and filters in a native <dialog>: a bottom sheet on a phone, a panel
 * down the right on a wide screen. Changes are a draft until Apply, so the
 * list does not refetch on every tap.
 */
export default function FilterSheet({ open, ...props }) {
  return open ? <Sheet {...props} /> : null;
}

function Sheet({ filters, mode, onApply, onClose }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(filters);
  useScrollLock();
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const sorts = SORTS.map((s) => (s.key === "eta" && mode === "pickup" ? { ...s, label: "Ready time" } : s));

  return (
    <dialog
      ref={ref}
      aria-labelledby="ke-filter-title"
      onClose={onClose}
      // A tap on the dimmed area outside the sheet closes it.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-[color:var(--ke-ink)] backdrop:bg-black/50 lg:ml-auto lg:mr-0 lg:mt-0 lg:h-full lg:max-h-none lg:w-[420px] lg:rounded-none"
    >
      <form
        className="flex max-h-[85vh] flex-col lg:h-full lg:max-h-none"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <h2 id="ke-filter-title" className="text-[18px] font-bold">
            Filters and sorting
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-500 ${FOCUS}`}>
            ×
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <Group legend="Sort by">
            {sorts.map((s) => (
              <Option key={s.key} type="radio" name="ke-sort" checked={draft.sort === s.key} onChange={() => set({ sort: s.key })} label={s.label} />
            ))}
          </Group>
          <Group legend="Rating">
            <Option type="radio" name="ke-rating" checked={!draft.minRating} onChange={() => set({ minRating: 0 })} label="Any" />
            {RATINGS.map((r) => (
              <Option key={r} type="radio" name="ke-rating" checked={draft.minRating === r} onChange={() => set({ minRating: r })} label={`${r.toFixed(1)}+`} />
            ))}
          </Group>
          <Group legend="Cost for two">
            <Option type="radio" name="ke-cost" checked={!draft.cost} onChange={() => set({ cost: "" })} label="Any" />
            {COST_BUCKETS.map((b) => (
              <Option key={b.key} type="radio" name="ke-cost" checked={draft.cost === b.key} onChange={() => set({ cost: b.key })} label={b.label} />
            ))}
          </Group>
          <Group legend="More">
            <Option type="checkbox" checked={draft.fast} onChange={(e) => set({ fast: e.target.checked })} label="Near & Fast" />
            <Option type="checkbox" checked={draft.offers} onChange={(e) => set({ offers: e.target.checked })} label="Offers" />
            <Option type="checkbox" checked={draft.pureVeg} onChange={(e) => set({ pureVeg: e.target.checked })} label="Pure Veg" />
          </Group>
        </div>
        <div className="flex gap-3 border-t border-slate-200 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
          {/* Clears what this sheet sets; a search word, dish or price cap stays. */}
          <button type="button" onClick={() => setDraft({ ...DEFAULT_FILTERS, q: draft.q, tag: draft.tag, maxPrice: draft.maxPrice })} className={`flex-1 ${BTN_SECONDARY}`}>
            Clear all
          </button>
          <button type="submit" className={`flex-1 ${BTN_PRIMARY}`}>
            Apply
          </button>
        </div>
      </form>
    </dialog>
  );
}

function Group({ legend, children }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-500">{legend}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/** A real radio or checkbox, drawn as a chip; the focus ring follows the input. */
function Option({ label, ...input }) {
  return (
    <label className="cursor-pointer">
      <input {...input} className="peer sr-only" />
      <span className="inline-flex min-h-[44px] items-center rounded-full border border-slate-300 px-4 text-[14px] font-medium text-slate-700 peer-checked:border-brand peer-checked:bg-orange-50 peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2">
        {label}
      </span>
    </label>
  );
}
