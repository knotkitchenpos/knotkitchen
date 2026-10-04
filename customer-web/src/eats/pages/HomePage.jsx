import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import EatsHeader from "../components/EatsHeader";
import SearchBox from "../components/SearchBox";
import VegToggle from "../components/VegToggle";
import CollectionTile from "../components/CollectionTile";
import DishChips from "../components/DishChips";
import FilterBar from "../components/FilterBar";
import { StoreGrid } from "../components/StoreCard";
import LocationPicker from "../components/LocationPicker";
import LocationPrompt from "../components/LocationPrompt";
import EmptyState from "../components/EmptyState";
import CartPill from "../components/CartPill";
import EatsFooter from "../components/EatsFooter";
import { useEatsLocation, useEatsPrefs } from "../../lib/eatsLocation";
import { activeFilterCount, filtersToSearch, readFilters, toApiParams } from "../../lib/eatsFilters";
import { getActiveCart } from "../../lib/eatsCart";
import { BTN_PRIMARY, BTN_SECONDARY, useEatsConfig, useStoreList, useTitle } from "../shared";

// A first visit with no location opens the picker by itself, once per page
// load; closing it leaves the prompt card.
let autoOpened = false;

/** `/`: restaurants delivering to, or near enough to pick up from, the chosen location. */
export default function HomePage() {
  useTitle("Order food near you");
  const { location } = useEatsLocation();
  const { mode, setMode, veg, setVeg } = useEatsPrefs();
  const config = useEatsConfig();
  const [sp, setSp] = useSearchParams();
  // Home lists by filters only; a search word, dish or price cap is /search's.
  const filters = useMemo(() => ({ ...readFilters(sp), q: "", tag: "", maxPrice: 0 }), [sp]);
  const params = useMemo(() => toApiParams({ filters, location, mode, veg }), [filters, location, mode, veg]);
  const list = useStoreList(params);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cart] = useState(getActiveCart);

  useEffect(() => {
    if (location || autoOpened) return;
    autoOpened = true;
    setPickerOpen(true);
  }, [location]);

  const setFilters = (f) => setSp(filtersToSearch(f), { replace: true });
  const clearFilters = () => {
    setSp("", { replace: true });
    setVeg(false);
  };
  const pickLocation = () => setPickerOpen(true);

  const facets = list.data?.facets;
  const collection = facets?.collections?.find((c) => c.storeCount > 0);
  const chipWords = (facets?.tags?.length ? facets.tags : config?.dishTags || []).map((t) => t.label);
  const area = location?.label || "your area";
  const filtered = activeFilterCount(filters) > 0 || veg;

  const empty = filtered ? (
    <EmptyState title="No restaurants match these filters" actions={<button type="button" onClick={clearFilters} className={BTN_PRIMARY}>Clear filters</button>} />
  ) : mode === "delivery" ? (
    <EmptyState
      title={`No restaurants deliver to ${area} yet.`}
      actions={
        <>
          <button type="button" onClick={() => setMode("pickup")} className={BTN_PRIMARY}>
            See pickup
          </button>
          <button type="button" onClick={pickLocation} className={BTN_SECONDARY}>
            Change location
          </button>
        </>
      }
    />
  ) : (
    <EmptyState title={`Knot Eats isn't in ${area} yet.`}>
      Own a restaurant?{" "}
      <a href="https://knotkitchen.com/#contact" className="font-semibold text-brand underline">
        List it on Knot Eats
      </a>
      .
    </EmptyState>
  );

  return (
    <div className={cart ? "pb-24" : ""}>
      <h1 className="sr-only">Knot Eats: order from restaurants near you</h1>
      <EatsHeader location={location} onPickLocation={pickLocation} />

      <div className="sticky top-0 z-30 bg-white shadow-[0_1px_0_rgb(226_232_240)]">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
          <SearchBox labels={chipWords} />
          <VegToggle />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">
        {!location ? (
          <LocationPrompt onPick={pickLocation} />
        ) : (
          <>
            <CollectionTile collection={collection} />
            {facets?.tags?.length ? (
              <section aria-labelledby="ke-dishes" className="mt-6">
                <h2 id="ke-dishes" className="mb-3 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
                  What&apos;s on your mind?
                </h2>
                <DishChips tags={facets.tags} />
              </section>
            ) : null}
            <FilterBar filters={filters} onChange={setFilters} mode={mode} />
            <h2 aria-live="polite" className="mb-4 mt-2 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
              {mode === "delivery" ? "Restaurants delivering to you" : "Restaurants for pickup near you"}
            </h2>
            <StoreGrid list={list} mode={mode} empty={empty} onChangeLocation={pickLocation} />
          </>
        )}
      </div>

      <EatsFooter />
      <CartPill cart={cart} />
      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
