import React from "react";

/** The ordering page's shape while it loads: details, then dish rows with a 4:3 photo. */
export default function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-white" aria-busy="true" aria-label="Loading restaurant">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-3">
            <div className="h-8 w-1/2 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
          </div>
          <div className="aspect-[4/3] w-28 animate-pulse rounded-xl bg-slate-200 sm:w-64" />
        </div>
        <div className="mt-8 space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/5 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
              </div>
              <div className="aspect-[4/3] w-[132px] animate-pulse rounded-xl bg-slate-200 sm:w-[156px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
