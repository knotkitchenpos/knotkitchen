import React, { useState } from "react";
import LocationPicker from "./LocationPicker";
import { distanceLabel, etaLabel } from "../../lib/eatsFormat";

/**
 * Under the store's details: where this restaurant would deliver to, or why
 * it is pickup only for this customer. "Change" opens the same picker as the
 * home page, so a new point re-quotes the store page and the cart at once.
 */
export default function LocationStrip({ location, delivery, reason }) {
  const [picking, setPicking] = useState(false);
  const eta = delivery?.deliverable ? [etaLabel(delivery.etaMinutes), distanceLabel(delivery.distanceKm, delivery.distanceSource)].filter(Boolean).join(" · ") : "";

  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[14px]">
      <p className="min-w-0 text-slate-700">
        {reason ? (
          <>
            <span className="font-semibold text-slate-900">Pickup only:</span> {reason}
          </>
        ) : (
          <>
            Delivering to <span className="font-semibold text-slate-900">{location?.label}</span>
            {eta ? <span className="text-slate-500"> · {eta}</span> : null}
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="min-h-[44px] shrink-0 px-2 font-semibold text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-brand"
      >
        Change
      </button>
      <LocationPicker open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}
