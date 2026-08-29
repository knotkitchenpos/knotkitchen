import React from "react";

const STYLES = {
  urgent: "bg-red-50 text-red-700 ring-red-600/20",
  high: "bg-orange-50 text-orange-700 ring-orange-600/20",
  normal: "bg-navy-100 text-navy-700 ring-navy-500/20",
  low: "bg-navy-50 text-navy-500 ring-navy-400/20",
};

const PriorityBadge = ({ priority }) => {
  if (!priority) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${
        STYLES[priority] || STYLES.normal
      }`}
    >
      {priority}
    </span>
  );
};

export default PriorityBadge;
