import React, { useState } from "react";
import FilterSheet from "./FilterSheet";
import { COST_BUCKETS, activeFilterCount } from "../../lib/eatsFilters";
import { FOCUS } from "../shared";

const CHIP = `inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[14px] font-medium ${FOCUS}`;
const chipTone = (on) => (on ? "border-brand bg-orange-50 text-brand" : "border-slate-200 bg-white text-slate-700");

/**
 * The row of quick filters over the list; each is a toggle (aria-pressed).
 * Cost steps through its three ranges and back to off. Filters opens the
 * sheet with sort and the rest.
 */
export default function FilterBar({ filters, onChange, mode }) {
  const [sheet, setSheet] = useState(false);
  const count = activeFilterCount(filters);
  const toggle = (patch) => onChange({ ...filters, ...patch });
  const costAt = COST_BUCKETS.findIndex((b) => b.key === filters.cost);
  const cost = COST_BUCKETS[costAt];
  const nextCost = costAt === COST_BUCKETS.length - 1 ? "" : COST_BUCKETS[costAt + 1].key;

  return (
    <>
      <div role="group" aria-label="Filters" className="-mx-4 flex gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:none]">
        <button type="button" aria-haspopup="dialog" onClick={() => setSheet(true)} className={`${CHIP} ${chipTone(count > 0)}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </svg>
          Filters
          {count ? (
            <span className="rounded-full bg-brand px-1.5 text-[12px] font-bold text-white">
              {count}
              <span className="sr-only"> on</span>
            </span>
          ) : null}
        </button>
        <button type="button" aria-pressed={filters.fast} onClick={() => toggle({ fast: !filters.fast })} className={`${CHIP} ${chipTone(filters.fast)}`}>
          <span aria-hidden="true">⚡</span> Near &amp; Fast
        </button>
        <button
          type="button"
          aria-pressed={filters.minRating > 0}
          onClick={() => toggle({ minRating: filters.minRating ? 0 : 4 })}
          className={`${CHIP} ${chipTone(filters.minRating > 0)}`}
        >
          Rating {(filters.minRating || 4).toFixed(1)}+
        </button>
        <button type="button" aria-pressed={filters.offers} onClick={() => toggle({ offers: !filters.offers })} className={`${CHIP} ${chipTone(filters.offers)}`}>
          Offers
        </button>
        <button type="button" aria-pressed={filters.pureVeg} onClick={() => toggle({ pureVeg: !filters.pureVeg })} className={`${CHIP} ${chipTone(filters.pureVeg)}`}>
          Pure Veg
        </button>
        <button
          type="button"
          aria-pressed={!!cost}
          aria-label={cost ? `Cost for two ${cost.label}. Tap for the next range` : "Cost for two"}
          onClick={() => toggle({ cost: nextCost })}
          className={`${CHIP} ${chipTone(!!cost)}`}
        >
          {cost ? `Cost ${cost.label}` : "Cost"}
        </button>
      </div>
      <FilterSheet
        open={sheet}
        filters={filters}
        mode={mode}
        onClose={() => setSheet(false)}
        onApply={(f) => {
          setSheet(false);
          onChange(f);
        }}
      />
    </>
  );
}
