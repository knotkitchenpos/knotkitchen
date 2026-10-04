import React from "react";
import { useSaved } from "../../lib/eatsSaved";
import { FOCUS } from "../shared";

export function BookmarkIcon({ filled = false }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="M6 3h12v18l-6-4.5L6 21z" />
    </svg>
  );
}

/** Bookmark a restaurant on this device (Saved page). A 44px round button, white so it reads over a photo. */
export default function SaveButton({ storeId, name }) {
  const { isSaved, toggle } = useSaved();
  const on = isSaved(storeId);
  return (
    <button
      type="button"
      onClick={() => toggle(storeId)}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from saved` : `Save ${name}`}
      className={`flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md ${on ? "text-brand" : "text-slate-700"} ${FOCUS}`}
    >
      <BookmarkIcon filled={on} />
    </button>
  );
}
