import React from "react";

/**
 * Asked only on a store that has analytics set up (GA4 / Meta Pixel): those
 * set cookies. The site itself keeps just the basket in this browser, which
 * needs no consent. Nothing loads until "Accept".
 */
export default function ConsentBanner({ privacyPath, onChoice }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[120] p-3 sm:p-4" role="region" aria-label="Cookie consent">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-2xl sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1">
          We use cookies to understand how visitors use this site and to improve it.{" "}
          {privacyPath ? (
            <a href={privacyPath} className="font-semibold text-slate-900 underline underline-offset-2">
              Privacy Policy
            </a>
          ) : null}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onChoice("denied")}
            className="rounded-full border border-slate-300 px-4 py-2 font-semibold text-slate-700"
          >
            Decline
          </button>
          <button type="button" onClick={() => onChoice("granted")} className="rounded-full bg-brand px-4 py-2 font-semibold text-brand-fg">
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
