import React from "react";

/**
 * Skeleton shown while the storefront payload loads (§34).
 * Mirrors the real layout so the page doesn't visibly jump when data arrives.
 */
const StorefrontSkeleton = () => (
  <div className="min-h-screen bg-white animate-pulse" aria-busy="true" aria-label="Loading restaurant">
    {/* Header */}
    <div className="border-b border-black/5 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-200" />
        <div className="space-y-2">
          <div className="h-4 w-40 bg-slate-200 rounded" />
          <div className="h-3 w-24 bg-slate-100 rounded" />
        </div>
        <div className="ml-auto h-9 w-24 bg-slate-200 rounded-xl" />
      </div>
    </div>

    {/* Hero */}
    <div className="h-[300px] sm:h-[360px] bg-slate-200" />

    {/* Menu */}
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="h-7 w-44 bg-slate-200 rounded mb-6" />

      <div className="flex gap-2 mb-8">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-9 w-24 bg-slate-100 rounded-full" />
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-black/5 overflow-hidden">
            <div className="h-40 bg-slate-200" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-3/4 bg-slate-200 rounded" />
              <div className="h-3 w-full bg-slate-100 rounded" />
              <div className="flex items-center justify-between pt-1">
                <div className="h-5 w-16 bg-slate-200 rounded" />
                <div className="h-8 w-20 bg-slate-200 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

    <span className="sr-only">Loading menu…</span>
  </div>
);

export default StorefrontSkeleton;
