import React from "react";

/**
 * The card's best offer, pinned to the photo's top-left edge. It never takes
 * a tap: swipes and taps reach the dish photo underneath.
 */
export default function OfferRibbon({ offer, count = 0 }) {
  if (!offer) return null;
  const more = count > 1 ? ` · +${count - 1} more` : "";
  return (
    <span className="pointer-events-none absolute left-0 top-3 max-w-[70%] rounded-r-lg bg-blue-700 px-2.5 py-1 text-white shadow-md">
      <span className="block truncate text-[13px] font-extrabold uppercase leading-tight">{offer.title}</span>
      <span className="block truncate text-[11px] font-medium leading-tight">
        {offer.subtitle}
        {more}
      </span>
    </span>
  );
}
