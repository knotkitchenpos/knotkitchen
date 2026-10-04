import React from "react";

/** A centred message where a list would be, with what to do next. */
export default function EmptyState({ title, children, actions }) {
  return (
    <div className="mx-auto my-10 max-w-md text-center">
      <p className="text-[18px] font-bold text-[color:var(--ke-ink)]">{title}</p>
      {children ? <p className="mt-1.5 text-[15px] text-slate-600">{children}</p> : null}
      {actions ? <div className="mt-5 flex flex-wrap justify-center gap-3">{actions}</div> : null}
    </div>
  );
}
