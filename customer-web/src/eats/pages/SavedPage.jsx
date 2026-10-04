import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import EatsHeader from "../components/EatsHeader";
import { StoreGrid } from "../components/StoreCard";
import LocationPicker from "../components/LocationPicker";
import LocationPrompt from "../components/LocationPrompt";
import EmptyState from "../components/EmptyState";
import EatsFooter from "../components/EatsFooter";
import { useEatsLocation, useEatsPrefs } from "../../lib/eatsLocation";
import { useSaved } from "../../lib/eatsSaved";
import { toApiParams } from "../../lib/eatsFilters";
import { recentOrders } from "../../lib/eatsOrders";
import { FOCUS, useStoreList, useTitle } from "../shared";

// The list endpoint takes 30 ids (§3.4). ponytail: newest 30 saves only; page the ids if anyone saves more.
const MAX_IDS = 30;

const placedOn = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

/** `/saved`: restaurants bookmarked on this device, then the orders placed from it. */
export default function SavedPage() {
  useTitle("Saved");
  const { ids, isSaved } = useSaved();
  const { location } = useEatsLocation();
  const { mode } = useEatsPrefs();
  // The ids as the page opened: un-saving hides a card at once instead of refetching the list.
  const [asked] = useState(() => ids.slice(0, MAX_IDS));
  const [orders] = useState(recentOrders);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickLocation = () => setPickerOpen(true);

  const params = useMemo(() => {
    const p = asked.length ? toApiParams({ location, mode }) : null;
    return p && { ...p, ids: asked.join(",") };
  }, [asked, location, mode]);
  const list = useStoreList(params);
  const shown = list.data ? { ...list, data: { ...list.data, stores: list.data.stores.filter((s) => isSaved(s.storeId)) } } : list;

  const none = <EmptyState title="No saved restaurants yet">Tap the bookmark on any restaurant to save it here.</EmptyState>;

  return (
    <>
      <EatsHeader location={location} onPickLocation={pickLocation} />
      <div className="mx-auto max-w-6xl px-4 pb-10">
        <h1 className="mt-4 text-[26px] font-extrabold text-[color:var(--ke-ink)]">Saved</h1>

        <section aria-labelledby="ke-saved-stores" className="mt-2">
          <h2 id="ke-saved-stores" className="mb-4 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
            Saved restaurants
          </h2>
          {!asked.length ? (
            none
          ) : !location ? (
            <LocationPrompt onPick={pickLocation}>Set your location to see how far your saved restaurants are.</LocationPrompt>
          ) : (
            <StoreGrid list={shown} mode={mode} empty={none} onChangeLocation={pickLocation} />
          )}
        </section>

        <section aria-labelledby="ke-recent-orders" className="mt-10">
          <h2 id="ke-recent-orders" className="mb-3 text-[13px] font-bold uppercase tracking-[0.15em] text-slate-500">
            Recent orders on this device
          </h2>
          {orders.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {orders.map((o) => (
                <li key={o.token}>
                  <Link
                    to={`/order/${o.token}`}
                    className={`flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 hover:border-brand ${FOCUS}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[color:var(--ke-ink)]">{o.storeName || "Your order"}</span>
                      <span className="block truncate text-[13px] text-slate-500">
                        {[o.orderNumber ? `Order #${o.orderNumber}` : "", placedOn(o.placedAt)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span aria-hidden="true" className="shrink-0 text-slate-400">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-slate-600">Orders you place on this device show here, so you can follow them.</p>
          )}
        </section>
      </div>
      <EatsFooter />
      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
