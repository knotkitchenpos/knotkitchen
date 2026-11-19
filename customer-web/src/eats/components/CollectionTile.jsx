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
      className={`mt-4 flex items-center justify-between gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0B1B3B] via-[#16294f] to-[#2a1a3f] px-5 py-5 shadow-lg ${FOCUS}`}
    >
      <span className="min-w-0">
        <span className="block text-[21px] font-extrabold leading-tight text-white">{collection.title}</span>
        <span className="mt-1 block text-[13px] font-medium text-amber-200">
          {n ? `${n} restaurant${n === 1 ? "" : "s"} near you` : "Pocket-friendly dishes near you"} ›
        </span>
      </span>
      <span aria-hidden="true" className="shrink-0 rotate-[-4deg] rounded-2xl bg-gradient-to-br from-[#FD5302] to-[#C2410C] px-3.5 py-2.5 text-center text-white shadow-lg ring-2 ring-white/20">
        <span className="block text-[10px] font-semibold uppercase tracking-wider">under</span>
        <span className="block text-[20px] font-extrabold leading-none">{inr(collection.maxPrice)}</span>
      </span>
    </Link>
  );
}
