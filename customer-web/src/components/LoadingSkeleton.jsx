import React from "react";

export default function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50" aria-busy="true" aria-label="Loading restaurant">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="h-40 rounded-3xl bg-slate-200 animate-pulse" />
        <div className="mt-6 space-y-3">
          <div className="h-6 w-1/3 rounded bg-slate-200 animate-pulse" />
          <div className="h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
