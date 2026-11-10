import React, { useEffect, useState } from "react";
import { FiBell, FiX } from "react-icons/fi";
import { pushState, enablePush } from "../lib/push";
import { errorMessage } from "../api";

/**
 * Asks once per device to turn on notifications for new customer WhatsApp
 * messages (owner, 2026-11-11: a popup instead of a button). Browsers only
 * show their permission prompt after a tap, so the popup's "Turn on" is that
 * tap. Shows nothing once notifications are on; "Not now" waits a day.
 */
const SNOOZE_KEY = "kk.push.snoozeUntil";
const DAY = 24 * 60 * 60 * 1000;

const snoozed = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; }
};
const snooze = (ms) => {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + ms)); } catch { /* private mode: it asks again next visit */ }
};

const COPY = {
  off: {
    title: "Turn on notifications?",
    body: "Get a notification on this device when a customer messages on WhatsApp, even when CSD is closed.",
  },
  "ios-install": {
    title: "Get notifications on this iPhone",
    body: "Apple only sends notifications to websites opened from the home screen. In Safari tap Share → Add to Home Screen, then open “KK Business” from your home screen and sign in.",
  },
  denied: {
    title: "Notifications are blocked",
    body: "To get new customer messages on this device, allow notifications for this site in the browser’s settings (the icon left of the address, or Settings → Notifications).",
  },
};

const NotificationsPrompt = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    if (snoozed()) return undefined;
    // Let the page settle first, so it does not pop up over the sign-in redirect.
    const t = setTimeout(() => {
      pushState().then((s) => alive && setState(s.state)).catch(() => {});
    }, 1200);
    return () => { alive = false; clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (!done) return undefined;
    const t = setTimeout(() => setState(null), 2500);
    return () => clearTimeout(t);
  }, [done]);

  const copy = COPY[state];
  if (!copy) return null;

  const close = (ms) => { snooze(ms); setState(null); };

  const turnOn = async () => {
    setBusy(true);
    setError("");
    try {
      await enablePush();
      setDone(true);
    } catch (err) {
      if (COPY[err?.code]) setState(err.code);
      else setError(errorMessage(err, "Could not turn notifications on. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label={copy.title}
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-sm rounded-2xl border border-navy-200 bg-white p-4 shadow-2xl sm:inset-x-auto sm:bottom-5 sm:right-5">
      {done ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <FiBell aria-hidden="true" /> Notifications are on for this device.
        </p>
      ) : (
        <>
          <button type="button" onClick={() => close(state === "off" ? DAY : 3 * DAY)} aria-label="Close"
            className="absolute right-3 top-3 text-navy-400 hover:text-navy-700">
            <FiX />
          </button>
          <div className="flex gap-3 pr-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <FiBell aria-hidden="true" />
            </span>
            <div>
              <p className="font-semibold text-navy-900">{copy.title}</p>
              <p className="mt-1 text-sm text-navy-600">{copy.body}</p>
              {error && <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">{error}</p>}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {state === "off" ? (
              <>
                <button type="button" onClick={() => close(DAY)} disabled={busy}
                  className="rounded-xl border border-navy-200 px-3.5 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">Not now</button>
                <button type="button" onClick={turnOn} disabled={busy}
                  className="rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
                  {busy ? "Turning on…" : "Turn on"}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => close(3 * DAY)}
                className="rounded-xl bg-navy-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-navy-700">OK</button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationsPrompt;
