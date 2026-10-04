import React from "react";
import { ratingView } from "../../lib/eatsFormat";

const TONES = {
  good: "bg-[color:var(--ke-good)] text-white",
  ok: "bg-[color:var(--ke-ok)] text-white",
  bad: "bg-[color:var(--ke-bad)] text-white",
  new: "border border-slate-300 text-slate-600",
};

/** "4.3 ★" in green, or "New" until a store has 3 visible reviews. */
export default function RatingBadge({ rating, count }) {
  const v = ratingView(rating, count);
  return (
    <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[13px] font-bold leading-5 ${TONES[v.tone]}`}>
      <span className="sr-only">{v.label}</span>
      <span aria-hidden="true">{v.text}</span>
      {v.tone === "new" ? null : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2l3 6.9 7.5.7-5.7 5 1.7 7.4L12 18.3 5.5 22l1.7-7.4-5.7-5 7.5-.7z" />
        </svg>
      )}
    </span>
  );
}
