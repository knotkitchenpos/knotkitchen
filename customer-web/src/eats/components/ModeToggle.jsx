import React from "react";
import { useEatsPrefs } from "../../lib/eatsLocation";
import { FOCUS, FOCUS_ON_HERO } from "../shared";

const MODES = [
  ["delivery", "Delivery"],
  ["pickup", "Pickup"],
];

/** Delivery | Pickup, remembered across visits. Changes which stores the list shows. */
export default function ModeToggle({ onHero = false }) {
  const { mode, setMode } = useEatsPrefs();
  return (
    <div role="group" aria-label="Order type" className={`flex shrink-0 rounded-full p-0.5 ${onHero ? "bg-black/20" : "bg-slate-100"}`}>
      {MODES.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={mode === key}
          onClick={() => setMode(key)}
          className={`h-11 rounded-full px-4 text-[14px] font-semibold ${onHero ? FOCUS_ON_HERO : FOCUS} ${
            mode === key ? "bg-white text-brand shadow" : onHero ? "text-white" : "text-slate-600"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
