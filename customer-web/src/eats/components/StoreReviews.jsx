import React, { useState } from "react";
import { getStoreReviews } from "../api";

export function Stars({ rating }) {
  const n = Math.round(Number(rating) || 0);
  return (
    <span role="img" aria-label={`Rated ${n} out of 5`} className="tracking-tight text-[color:var(--ke-ok,#B45309)]">
      {"★".repeat(n)}
      <span className="text-slate-300">{"★".repeat(5 - n)}</span>
    </span>
  );
}

const day = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

/**
 * The store page's reviews: the average (from 3 reviews, §6.4), the latest
 * three with text from the store payload, and "See all" paging through every
 * visible review. Review text is rendered as text, never HTML.
 */
export default function StoreReviews({ storeId, rating, ratingCount = 0, reviews = [] }) {
  const [all, setAll] = useState(null); // { list, page, hasMore } once "See all" is used
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const more = (page) => {
    setLoading(true);
    setFailed(false);
    getStoreReviews(storeId, page)
      .then((res) => {
        const d = res.data.data;
        setAll((prev) => ({ list: [...(page > 1 ? prev?.list || [] : []), ...(d.reviews || [])], page, hasMore: Boolean(d.hasMore) }));
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  const list = all ? all.list : reviews;
  if (rating == null && !list.length) return null;

  return (
    <section className="mt-5" aria-labelledby="ke-reviews">
      <h2 id="ke-reviews" className="text-[17px] font-semibold text-slate-900">
        {rating != null ? `${Number(rating).toFixed(1)} ★ · ${ratingCount} ratings` : "Reviews"}
      </h2>
      <ul className="mt-2 space-y-3">
        {list.map((r, i) => (
          <li key={`${r.createdAt}-${i}`} className="rounded-xl border border-slate-200 p-3 text-[14px]">
            <div className="flex items-center justify-between gap-2">
              <Stars rating={r.rating} />
              <span className="text-[12px] text-slate-500">{day(r.createdAt)}</span>
            </div>
            {r.text ? <p className="mt-1 whitespace-pre-line break-words text-slate-700">{r.text}</p> : null}
            <p className="mt-1 text-[12px] text-slate-500">{r.authorName}</p>
          </li>
        ))}
      </ul>
      {failed ? (
        <p role="alert" className="mt-2 text-[13px] text-red-600">
          Couldn&apos;t load reviews.
        </p>
      ) : null}
      {(all ? all.hasMore : ratingCount > reviews.length) ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => more(all ? all.page + 1 : 1)}
          className="mt-2 min-h-[44px] font-semibold text-brand underline-offset-2 hover:underline disabled:opacity-50"
        >
          {loading ? "Loading…" : all ? "Show more reviews" : "See all reviews"}
        </button>
      ) : null}
    </section>
  );
}
