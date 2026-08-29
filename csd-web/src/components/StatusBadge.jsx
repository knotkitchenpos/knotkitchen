import React from "react";

/**
 * Single source of truth for status colour across the panel.
 *
 * The spec requires consistent status colours; centralising the map here is
 * what makes that true in practice — a per-page ternary drifts immediately.
 * Covers store statuses, job statuses and staff statuses in one vocabulary.
 */
const STYLES = {
  // Stores
  active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pending: "bg-amber-50 text-amber-700 ring-amber-600/20",
  suspended: "bg-red-50 text-red-700 ring-red-600/20",
  closed_temporarily: "bg-orange-50 text-orange-700 ring-orange-600/20",
  closed_until: "bg-orange-50 text-orange-700 ring-orange-600/20",
  deleted: "bg-navy-100 text-navy-600 ring-navy-500/20",
  // Staff
  disabled: "bg-navy-100 text-navy-600 ring-navy-500/20",
  // Jobs (used from Phase 3)
  open: "bg-sky-50 text-sky-700 ring-sky-600/20",
  in_progress: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  completed: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  closed: "bg-navy-100 text-navy-600 ring-navy-500/20",
};

const LABELS = {
  closed_temporarily: "Closed temporarily",
  closed_until: "Closed until date",
  in_progress: "In progress",
};

const humanise = (s) =>
  LABELS[s] || String(s || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const StatusBadge = ({ status, className = "" }) => {
  if (!status) return null;
  const style = STYLES[status] || "bg-navy-100 text-navy-600 ring-navy-500/20";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style} ${className}`}
    >
      {humanise(status)}
    </span>
  );
};

export default StatusBadge;
