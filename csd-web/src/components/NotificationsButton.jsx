import React, { useEffect, useRef, useState } from "react";
import { FiBell, FiBellOff, FiX } from "react-icons/fi";
import { pushState, enablePush, disablePush } from "../lib/push";
import { push as pushApi, errorMessage } from "../api";

/**
 * "Notifications" on this device: new customer WhatsApp messages arrive as
 * phone/computer notifications even with CSD closed.
 */
const HELP = {
  "ios-install": {
    title: "On iPhone, add CSD to your home screen first",
    body: "Apple only sends notifications to websites opened from the home screen. In Safari tap Share → Add to Home Screen, open “KK Business” from your home screen, sign in, and turn notifications on there.",
  },
  denied: {
    title: "Notifications are blocked for this site",
    body: "Allow them in the browser’s site settings (the icon left of the address, or Settings → Notifications), then come back and turn them on.",
  },
  unsupported: {
    title: "This browser cannot show notifications",
    body: "Use Chrome on Android or a computer, or Safari on an iPhone with CSD added to the home screen.",
  },
};

const NotificationsButton = () => {
  const [state, setState] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    pushState().then((s) => alive && setState(s.state)).catch(() => alive && setState("off"));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const turnOn = async () => {
    setBusy(true);
    setMessage("");
    try {
      setState(await enablePush());
      setMessage("Notifications are on for this device.");
      setOpen(true);
    } catch (err) {
      if (HELP[err?.code]) { setState(err.code); setOpen(true); } else setMessage(errorMessage(err, "Could not turn notifications on."));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      setState(await disablePush());
      setMessage("Notifications are off for this device.");
    } catch (err) {
      setMessage(errorMessage(err, "Could not turn notifications off."));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await pushApi.test();
      setMessage("Test sent. It should appear in a few seconds.");
    } catch (err) {
      setMessage(errorMessage(err, "Could not send a test."));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") return null;
  const on = state === "on";
  const help = HELP[state];

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={busy}
        onClick={() => (on || help ? setOpen((o) => !o) : turnOn())}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold ${
          on ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100" : "bg-white text-navy-700 ring-1 ring-navy-200 hover:bg-navy-50"
        } disabled:opacity-60`}>
        {on ? <FiBell aria-hidden="true" /> : <FiBellOff aria-hidden="true" />}
        {on ? "Notifications on" : "Turn on notifications"}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
          className="absolute left-0 sm:left-auto sm:right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-navy-200 bg-white p-4 text-sm shadow-xl">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 text-navy-400 hover:text-navy-700">
            <FiX />
          </button>
          {help ? (
            <>
              <p className="pr-5 font-semibold text-navy-900">{help.title}</p>
              <p className="mt-1.5 text-navy-600">{help.body}</p>
            </>
          ) : (
            <>
              <p className="pr-5 font-semibold text-navy-900">Notifications on this device</p>
              <p className="mt-1.5 text-navy-600">
                New customer WhatsApp messages pop up here even when CSD is closed. Fast2SMS passes them on about once a minute.
              </p>
              {message && <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800">{message}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={test} disabled={busy}
                  className="rounded-xl bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy-700 disabled:opacity-50">Send a test</button>
                <button type="button" onClick={turnOff} disabled={busy}
                  className="rounded-xl border border-navy-200 px-3 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50">Turn off</button>
              </div>
            </>
          )}
        </div>
      )}
      {!open && message && !on && <p className="absolute left-0 sm:left-auto sm:right-0 mt-1 whitespace-nowrap text-xs text-navy-500">{message}</p>}
    </div>
  );
};

export default NotificationsButton;
