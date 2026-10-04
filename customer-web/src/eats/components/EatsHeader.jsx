import React from "react";
import { Link } from "react-router-dom";
import ModeToggle from "./ModeToggle";
import { BookmarkIcon } from "./SaveButton";
import { FOCUS } from "../shared";

export function PinIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

/**
 * Top of Home and Saved: the wordmark, where we are looking (tap to change),
 * Delivery | Pickup, and the Saved page. The page owns the picker, because
 * its own prompts open the same one.
 */
export default function EatsHeader({ location, onPickLocation }) {
  const sub = location?.address || (location?.source === "area" ? "Area: pick an exact spot to get delivery" : "");
  return (
    <header className="bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-3">
        <Link to="/" className={`rounded text-[26px] font-extrabold leading-none tracking-tight text-[color:var(--ke-ink)] ${FOCUS}`}>
          knot <span className="text-[color:var(--accent)]">eats</span>
        </Link>
        <Link
          to="/saved"
          aria-label="Saved restaurants and recent orders"
          className={`flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 ${FOCUS}`}
        >
          <BookmarkIcon />
        </Link>
      </div>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pb-2 pt-1">
        <button
          type="button"
          onClick={onPickLocation}
          aria-label={location ? `Location: ${location.label}. Change location` : "Set your location"}
          className={`flex min-h-[44px] min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left ${FOCUS}`}
        >
          <span className="shrink-0 text-brand">
            <PinIcon />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[16px] font-bold text-[color:var(--ke-ink)]">
              <span className="truncate">{location?.label || "Set your location"}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
            {sub ? <span className="block truncate text-[12px] text-slate-500">{sub}</span> : null}
          </span>
        </button>
        <ModeToggle />
      </div>
    </header>
  );
}
