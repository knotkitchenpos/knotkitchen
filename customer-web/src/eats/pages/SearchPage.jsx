import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import VegToggle from "../components/VegToggle";
import DishChips from "../components/DishChips";
import FilterBar from "../components/FilterBar";
import { StoreGrid } from "../components/StoreCard";
import LocationPicker from "../components/LocationPicker";
import LocationPrompt from "../components/LocationPrompt";
import EmptyState from "../components/EmptyState";
import { useEatsLocation, useEatsPrefs } from "../../lib/eatsLocation";
import { DEFAULT_FILTERS, activeFilterCount, filtersToSearch, readFilters, searchQuery, syncSearchText, toApiParams } from "../../lib/eatsFilters";
import { inr, tagText } from "../../lib/eatsFormat";
import { BTN_PRIMARY, FOCUS, useEatsConfig, useStoreList, useTitle } from "../shared";

/**
 * `/search?q=&tag=&maxPrice=`: restaurants by name or dish, a dish chip, or
 * "Meals under ₹250". Every result is a StoreCard whose carousel shows the
 * dishes that matched.
 */
export default function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => readFilters(sp), [sp]);
  const [text, setText] = useState(filters.q);
  const config = useEatsConfig();
  const { location } = useEatsLocation();
  const { mode, veg, setVeg } = useEatsPrefs();
  const [pickerOpen, setPickerOpen] = useState(false);

  // The query goes into the URL 250 ms after the last key (so Back and a
  // shared link keep it); the list hook aborts the request it replaces.
  // Typing a word leaves the dish or price page for a plain search.
  // The q this box last wrote. The URL echoing it back arrives in a
  // transition, possibly after another key: it must not undo that key.
  const wroteQ = useRef(filters.q);
  useEffect(() => {
    const q = searchQuery(text);
    if (q === filters.q) return undefined;
    const t = window.setTimeout(() => {
      const next = q ? { ...filters, q, tag: "", maxPrice: 0 } : { ...filters, q };
      wroteQ.current = q;
      setSp(filtersToSearch(next), { replace: true });
    }, 250);
    return () => window.clearTimeout(t);
  }, [text, filters, setSp]);
  // A dish chip, Back or a link changes ?q= under the box: follow it.
  useEffect(() => {
    if (filters.q !== wroteQ.current) setText((t) => syncSearchText(t, filters.q));
    wroteQ.current = filters.q;
  }, [filters.q]);

  const tagLabel = filters.tag ? tagText([filters.tag], config?.dishTags) : "";
  const priceTitle = filters.maxPrice
    ? config?.collections?.find((c) => c.maxPrice === filters.maxPrice)?.title || `Meals under ${inr(filters.maxPrice)}`
    : "";
  const title = tagLabel || priceTitle;
  useTitle(title || (filters.q ? `“${filters.q}”` : "Search"));

  // One letter is not a search yet (the server wants 2 to 40).
  const searching = filters.q.length >= 2 || !!filters.tag || !!filters.maxPrice;
  const params = useMemo(
    () => (searching ? toApiParams({ filters, location, mode, veg }) : null),
    [searching, filters, location, mode, veg],
  );
  const list = useStoreList(params);
  const pickLocation = () => setPickerOpen(true);

  const empty =
    activeFilterCount(filters) > 0 || veg ? (
      <EmptyState
        title="No restaurants match these filters"
        actions={
          <button
            type="button"
            onClick={() => {
              setSp(filtersToSearch({ ...DEFAULT_FILTERS, q: filters.q, tag: filters.tag, maxPrice: filters.maxPrice }), { replace: true });
              setVeg(false);
            }}
            className={BTN_PRIMARY}
          >
            Clear filters
          </button>
        }
      />
    ) : (
      <EmptyState title={filters.q ? `Nothing near you matches “${filters.q}”` : "No restaurants near you have these dishes yet"}>
        Try another dish or restaurant name.
      </EmptyState>
    );

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <Link to="/" aria-label="Back to Knot Eats" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 ${FOCUS}`}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <label htmlFor="ke-search" className="sr-only">
            Search for restaurants and dishes
          </label>
          <input
            id="ke-search"
            type="search"
            // A dish chip or the price tile already shows results: no keyboard over them.
            autoFocus={!filters.tag && !filters.maxPrice}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={40}
            enterKeyHint="search"
            placeholder="Restaurant name or a dish…"
            className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-[16px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <VegToggle />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-10">
        <h1 className={title ? "mt-5 text-[26px] font-extrabold text-[color:var(--ke-ink)]" : "sr-only"}>{title || "Search Knot Eats"}</h1>
        {!location ? (
          <LocationPrompt onPick={pickLocation}>Set your location to search the restaurants near you.</LocationPrompt>
        ) : !searching ? (
          <section aria-labelledby="ke-popular" className="mt-5">
            <h2 id="ke-popular" className="mb-3 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
              Popular dishes
            </h2>
            <DishChips tags={config?.dishTags || []} />
          </section>
        ) : (
          <>
            <FilterBar filters={filters} onChange={(f) => setSp(filtersToSearch(f), { replace: true })} mode={mode} />
            <h2 aria-live="polite" className="mb-4 mt-2 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
              {filters.q ? `Restaurants for “${filters.q}”` : mode === "delivery" ? "Restaurants delivering to you" : "Restaurants for pickup near you"}
            </h2>
            <StoreGrid list={list} mode={mode} empty={empty} onChangeLocation={pickLocation} />
          </>
        )}
      </div>
      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
