import React from "react";
import { NavLink } from "react-router-dom";
import { FOCUS, FOCUS_ON_HERO } from "../shared";

const svg = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

const TABS = [
  {
    to: "/",
    label: "Home",
    icon: (
      <svg {...svg}>
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    to: "/search",
    label: "Search",
    icon: (
      <svg {...svg}>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    ),
  },
  {
    to: "/saved",
    label: "Favourites",
    icon: (
      <svg {...svg}>
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
      </svg>
    ),
  },
  {
    to: "/orders",
    label: "Orders",
    icon: (
      <svg {...svg}>
        <path d="M6 2h12l1 4H5zM5 6h14l-1 15H6z" />
        <path d="M9 11h6M9 15h4" />
      </svg>
    ),
  },
  {
    to: "/account",
    label: "Account",
    icon: (
      <svg {...svg}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
];

/**
 * The app's tabs, along the bottom of a phone (a wide screen reaches the same
 * pages from the header). On the browse pages only: a restaurant, checkout
 * and an order page keep the whole screen.
 */
export default function BottomNav() {
  return (
    <nav aria-label="Knot Eats" className="fixed inset-x-0 bottom-0 z-[80] border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {TABS.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? "text-brand" : "text-slate-500"} ${FOCUS}`
              }
            >
              {t.icon}
              {t.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The same pages for a wide screen, in the header. */
export function HeaderLinks({ onHero = false }) {
  const tone = (isActive) =>
    onHero
      ? `${isActive ? "bg-white/15 text-white" : "text-orange-50 hover:bg-white/10"} ${FOCUS_ON_HERO}`
      : `${isActive ? "text-brand" : "text-slate-600 hover:bg-slate-100"} ${FOCUS}`;
  return (
    <nav aria-label="Knot Eats" className="hidden items-center gap-1 md:flex">
      {TABS.slice(1).map((t) => (
        <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold ${tone(isActive)}`}>
          {t.icon}
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
