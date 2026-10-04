import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import RatingBadge from "./RatingBadge";
import OfferRibbon from "./OfferRibbon";
import SaveButton from "./SaveButton";
import EmptyState from "./EmptyState";
import { thumbUrl } from "../../lib/thumbUrl";
import { costLabel, distanceLabel, etaLabel, inr, tagText } from "../../lib/eatsFormat";
import { BTN_PRIMARY, BTN_SECONDARY, FOCUS, useEatsConfig } from "../shared";

/**
 * One restaurant in a list, the way food apps show it: a carousel of its
 * dishes (each opens that dish on the store page), the best offer and the
 * bookmark over the photo, then name, rating, time and distance, and what it
 * serves. An <article> of sibling links and one button; nothing interactive
 * inside anything interactive.
 */
export default function StoreCard({ store, mode, eager = false, dishTags }) {
  const href = `/store/${store.storeId}`;
  const closed = !store.isOpen;
  const slides = (store.dishes || []).filter((d) => d.image).slice(0, 5);
  const img = `h-full w-full object-cover ${closed ? "grayscale" : ""}`;
  const dist = distanceLabel(store.distanceKm, store.distanceSource);
  const when =
    mode === "pickup"
      ? [store.prepTimeMinutes ? `Ready in ~${store.prepTimeMinutes} mins` : "", dist]
      : store.deliverable === false
        ? ["Pickup only", dist]
        : [etaLabel(store.etaMinutes), dist];
  const serves = [tagText(store.tags, dishTags), costLabel(store.priceForTwo)].filter(Boolean).join(" · ");

  return (
    <article className={closed ? "opacity-70" : ""}>
      <div className="relative overflow-hidden rounded-2xl bg-slate-100">
        {slides.length ? (
          <ul aria-label={`Dishes at ${store.name}`} className="flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none]">
            {slides.map((d, i) => (
              <li key={d.itemId} className={`${slides.length > 1 ? "w-[92%]" : "w-full"} shrink-0 snap-start`}>
                <Link to={`${href}?dish=${encodeURIComponent(d.itemId)}`} className={`relative block aspect-[4/3] overflow-hidden rounded-2xl ${FOCUS}`}>
                  <img
                    src={thumbUrl(d.image, 640)}
                    alt={`${d.name}, ${inr(d.price)}`}
                    loading={eager && i === 0 ? "eager" : "lazy"}
                    // React 18 passes only the lowercase spelling through without a warning.
                    // eslint-disable-next-line react/no-unknown-property
                    fetchpriority={eager && i === 0 ? "high" : undefined}
                    decoding="async"
                    className={img}
                  />
                  {/* The alt already says this; the caption is for sighted readers. */}
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-2.5 pt-10 text-white">
                    <span className="block truncate text-[15px] font-semibold">{d.name}</span>
                    <span className="text-[13px]">{inr(d.price)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          // The name link below is the way in; this copy of it stays out of the tab order.
          <Link to={href} tabIndex={-1} aria-hidden="true" className="block aspect-[4/3]">
            {store.cover ? (
              <img
                src={thumbUrl(store.cover, 640)}
                alt=""
                loading={eager ? "eager" : "lazy"}
                // eslint-disable-next-line react/no-unknown-property
                fetchpriority={eager ? "high" : undefined}
                decoding="async"
                className={img}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-orange-50 to-slate-100 text-[56px] font-extrabold text-slate-300">
                {store.name?.charAt(0)}
              </span>
            )}
          </Link>
        )}
        <OfferRibbon offer={store.offer} count={store.offerCount} />
        <div className="absolute right-2 top-2">
          <SaveButton storeId={store.storeId} name={store.name} />
        </div>
      </div>

      <div className="px-1 pt-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 break-words text-[18px] font-bold leading-snug text-[color:var(--ke-ink)]">
            <Link to={href} className={`rounded ${FOCUS}`}>
              {store.name}
            </Link>
          </h3>
          <RatingBadge rating={store.rating} count={store.ratingCount} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[14px] text-slate-600">
          {store.nearFast && mode !== "pickup" ? (
            <span className="font-semibold text-[color:var(--ke-good)]">
              <span aria-hidden="true">⚡</span> Near &amp; Fast ·
            </span>
          ) : null}
          {when.filter(Boolean).join(" · ")}
        </p>
        {serves ? <p className="mt-0.5 truncate text-[14px] text-slate-500">{serves}</p> : null}
        {closed ? (
          <p className="mt-1 text-[13px] font-semibold text-[color:var(--ke-bad)]">
            Closed now{store.closedReason ? ` · ${store.closedReason}` : ""}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function CardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="aspect-[4/3] rounded-2xl bg-slate-200 motion-safe:animate-pulse" />
      <div className="mt-3 h-5 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse" />
      <div className="mt-2 h-4 w-1/2 rounded bg-slate-200 motion-safe:animate-pulse" />
    </div>
  );
}

/**
 * A list of StoreCards from useStoreList: skeletons first, then 1/2/3
 * columns, more pages as the end comes near (with a button for keyboards and
 * old browsers), and the error and empty states. Cards already shown stay
 * on screen when a later request fails.
 */
export function StoreGrid({ list, mode, empty, onChangeLocation }) {
  const { data, loading, error, loadMore, retry } = list;
  const config = useEatsConfig();
  const sentinel = useRef(null);
  const more = !!data?.hasMore && !error;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [more, loadMore, data]);

  if (!data && error) {
    // 400: the point is outside India or unusable; picking another fixes it.
    return error.status === 400 ? (
      <EmptyState
        title="We can't look for restaurants there"
        actions={onChangeLocation ? <button type="button" onClick={onChangeLocation} className={BTN_PRIMARY}>Change location</button> : null}
      >
        {error.message || "Pick a location in India."}
      </EmptyState>
    ) : (
      <EmptyState title="Couldn't load restaurants" actions={<button type="button" onClick={retry} className={BTN_PRIMARY}>Retry</button>}>
        Check your connection and try again.
      </EmptyState>
    );
  }
  if (!data) {
    return (
      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading restaurants">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  // A page can come back empty after the road-distance cut with more to
  // come: the sentinel below fetches the next one, so "empty" waits for hasMore.
  if (!data.stores.length && !more && !error) return loading ? null : empty;

  return (
    <>
      <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
        {data.stores.map((s, i) => (
          <li key={s.storeId}>
            <StoreCard store={s} mode={mode} eager={i === 0} dishTags={config?.dishTags} />
          </li>
        ))}
      </ul>
      {error ? (
        <div role="alert" className="mt-6 flex flex-wrap items-center justify-center gap-3 text-[15px] text-slate-700">
          Couldn&apos;t load restaurants.
          <button type="button" onClick={retry} className={BTN_SECONDARY}>
            Retry
          </button>
        </div>
      ) : null}
      {more ? (
        <div ref={sentinel} className="mt-8 flex justify-center">
          <button type="button" onClick={loadMore} disabled={loading} className={BTN_SECONDARY}>
            {loading ? "Loading…" : "Show more restaurants"}
          </button>
        </div>
      ) : null}
    </>
  );
}
