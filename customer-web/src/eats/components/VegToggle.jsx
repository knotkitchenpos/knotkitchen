import React from "react";
import { useEatsPrefs } from "../../lib/eatsLocation";
import { FOCUS } from "../shared";

/** VEG: lists only stores with veg dishes, shows only those dishes, and opens store menus veg-only. */
export default function VegToggle() {
  const { veg, setVeg } = useEatsPrefs();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={veg}
      aria-label="Veg only"
      onClick={() => setVeg(!veg)}
      className={`flex min-h-[44px] min-w-[44px] shrink-0 flex-col items-center justify-center rounded-lg px-1 ${FOCUS}`}
    >
      <span className="text-[11px] font-extrabold tracking-wider text-[color:var(--ke-good)]">VEG</span>
      <span
        aria-hidden="true"
        className={`relative mt-1 h-5 w-9 rounded-full motion-safe:transition-colors ${veg ? "bg-[color:var(--ke-good)]" : "bg-slate-300"}`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow motion-safe:transition-transform ${veg ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}
