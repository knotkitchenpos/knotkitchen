import React from "react";

/**
 * One line at the top of the till when the internet is down or orders are
 * waiting, plus one more when the server refused some: those stay on the
 * device until staff retry or discard them, so no paid sale vanishes silently.
 */
const OfflineBanner = ({ online, queued, rejected = [], onSync, onDiscard }) => {
  if (online && !queued) return null;
  return (
    <div role="status" className={`px-4 py-2 text-[12.5px] font-bold ${online ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#0F172A] text-white"}`}>
      <div className="flex items-center justify-between gap-3">
        <span>
          {online
            ? `${queued} order(s) taken offline are waiting to sync.`
            : `No internet. Orders are saved on this device${queued ? ` (${queued} waiting)` : ""} and sync when it is back. Website and QR orders will not arrive until then.`}
        </span>
        {online && (
          <button type="button" onClick={onSync} className="shrink-0 rounded-lg border border-[#92400E]/30 px-2.5 py-1 hover:bg-[#FDE68A]">
            {rejected.length ? "Retry" : "Sync now"}
          </button>
        )}
      </div>
      {rejected.length > 0 && (
        <div className={`mt-1.5 flex flex-wrap items-center gap-2 ${online ? "text-[#B91C1C]" : "text-[#FCA5A5]"}`}>
          <span>
            {rejected.length} offline order(s) were refused: {rejected[0].error}
          </span>
          {rejected.map((e) => (
            <button
              key={e.localId}
              type="button"
              onClick={() => onDiscard(e.localId)}
              className="rounded-lg border border-current px-2 py-0.5 opacity-90 hover:opacity-100"
            >
              Discard {e.localNumber}…
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default OfflineBanner;
