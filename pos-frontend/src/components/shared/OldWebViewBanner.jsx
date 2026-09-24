import React, { useState } from "react";
import { oldWebViewVersion } from "../../utils/webview";

/**
 * The Android app draws with the tablet's "Android System WebView". An old
 * one (Chrome 94 on some tablets) shows the ₹ sign broken on Cashfree's
 * payment page and scrolls heavy screens slowly -- things no code in the POS
 * can change. Updating the WebView from the Play Store fixes them, so the
 * till says so, once, until dismissed.
 */
const KEY = "kk_old_webview_dismissed";

const readDismissed = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const OldWebViewBanner = () => {
  const [hidden, setHidden] = useState(readDismissed);
  const version = oldWebViewVersion();
  if (!version || hidden) return null;
  return (
    <div role="status" className="flex items-start justify-between gap-3 px-4 py-2 text-[12.5px] font-bold bg-[#FEF3C7] text-[#92400E]">
      <span>
        This tablet&apos;s web engine is out of date (Android System WebView {version}). Prices on the payment page can
        show a broken ₹ sign. Open the Play Store, search &quot;Android System WebView&quot; and tap Update.
      </span>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* private mode: it just shows again next time */
          }
          setHidden(true);
        }}
        className="shrink-0 rounded-lg border border-[#92400E]/30 px-2.5 py-1 hover:bg-[#FDE68A]"
      >
        OK
      </button>
    </div>
  );
};

export default OldWebViewBanner;
