import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FOCUS } from "../shared";

export function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Home's search: a link to /search dressed as a field, so the keyboard opens
 * on the page built for typing. The suggested dish rotates every 2.5 s, only
 * when the visitor allows motion; it is decoration, hidden from screen readers.
 */
export default function SearchBox({ labels = [] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (labels.length < 2 || reducedMotion()) return undefined;
    const t = window.setInterval(() => setI((n) => n + 1), 2500);
    return () => window.clearInterval(t);
  }, [labels.length]);
  const word = (labels.length ? labels[i % labels.length] : "biryani").toLowerCase();

  return (
    <Link
      to="/search"
      aria-label="Search for restaurants and dishes"
      className={`flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 text-[15px] text-slate-500 shadow-sm ${FOCUS}`}
    >
      <span className="text-brand">
        <SearchIcon />
      </span>
      <span className="truncate">
        Search “<span aria-hidden="true">{word}</span>”
      </span>
    </Link>
  );
}
