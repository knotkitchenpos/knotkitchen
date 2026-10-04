import React from "react";
import { BTN_PRIMARY } from "../shared";

/** Shown instead of a list until there is a location: nothing is fetched without one (§10.7). */
export default function LocationPrompt({ onPick, children }) {
  return (
    <section aria-labelledby="ke-loc-prompt" className="my-6 rounded-2xl border border-orange-100 bg-orange-50 p-5">
      <h2 id="ke-loc-prompt" className="text-[18px] font-bold text-[color:var(--ke-ink)]">
        Where should we look?
      </h2>
      <p className="mt-1 text-[15px] text-slate-700">
        {children || "Set your location to see the restaurants that deliver to you, or are close enough to pick up from."}
      </p>
      <button type="button" onClick={onPick} className={`mt-4 ${BTN_PRIMARY}`}>
        Set location
      </button>
    </section>
  );
}
