import React from "react";

/** One line at the top of the till when the internet is down or orders are waiting. */
const OfflineBanner = ({ online, queued, onSync }) => {
  if (online && !queued) return null;
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 px-4 py-2 text-[12.5px] font-bold ${
        online ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#0F172A] text-white"
      }`}
    >
      <span>
        {online
          ? `${queued} order(s) taken offline are waiting to sync.`
          : `No internet. Orders are saved on this device${queued ? ` (${queued} waiting)` : ""} and sync when it is back. Website and QR orders will not arrive until then.`}
      </span>
      {online && (
        <button type="button" onClick={onSync} className="shrink-0 rounded-lg border border-[#92400E]/30 px-2.5 py-1 hover:bg-[#FDE68A]">
          Sync now
        </button>
      )}
    </div>
  );
};

export default OfflineBanner;
