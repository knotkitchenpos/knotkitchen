import React from "react";
import { Link } from "react-router-dom";
import { inr } from "../../lib/eatsFormat";
import { FOCUS } from "../shared";

/** "Meals under ₹250": a banner into the same list, filtered by dish price. */
export default function CollectionTile({ collection }) {
  if (!collection) return null;
  const n = collection.storeCount;
  return (
    <Link
      to={`/search?maxPrice=${collection.maxPrice}`}
      className={`mt-3 flex items-center justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-orange-50 to-orange-100 px-5 py-4 ${FOCUS}`}
    >
      <span className="min-w-0">
        <span className="block text-[19px] font-extrabold leading-tight text-[color:var(--ke-ink)]">{collection.title}</span>
        <span className="mt-0.5 block text-[13px] text-slate-600">
          {n ? `${n} restaurant${n === 1 ? "" : "s"} near you` : "Pocket-friendly dishes near you"} ›
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 rounded-xl bg-brand px-3 py-2 text-center text-white shadow">
        <span className="block text-[10px] font-semibold uppercase tracking-wider">under</span>
        <span className="block text-[20px] font-extrabold leading-none">{inr(collection.maxPrice)}</span>
      </span>
    </Link>
  );
}
