import React, { useEffect, useState } from "react";
import { useSnackbar } from "notistack";
import { enablePush, pushState } from "../push";
import { Icon } from "./ui";

/*
 * Notifications are asked for from a card the rider taps, after they are
 * signed in and can see why: never a browser prompt on first load.
 */

const BLOCKERS = {
  denied: "Notifications are blocked for this site. Open your browser's site settings for knotkitchen.com, allow Notifications, then come back.",
  "ios-install": "On iPhone, add this app to your Home Screen first (Share > Add to Home Screen), then open it from there to turn on alerts.",
  unsupported: "This browser can't show delivery alerts. Use Chrome on Android for alerts.",
};

/** Push state for this device, refreshed when the app comes back to the front. */
export const usePushState = () => {
  const [state, setState] = useState("checking");
  useEffect(() => {
    let live = true;
    const check = () => pushState().then((s) => live && setState(s), () => live && setState("off"));
    check();
    const onVis = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return [state, setState];
};

export function AlertsPrompt() {
  const { enqueueSnackbar } = useSnackbar();
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  if (state === "on" || state === "checking") return null;
  const blocked = BLOCKERS[state];
  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      setState("on");
      enqueueSnackbar("Delivery alerts are on 🔔", { variant: "success" });
    } catch (err) {
      setState(err?.code || "off");
      enqueueSnackbar(BLOCKERS[err?.code] || "Couldn't turn alerts on. Try again.", { variant: "warning" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="r-card flex gap-3 p-4" style={{ borderColor: "var(--r-amber)" }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--r-amber-soft)", color: "var(--r-amber)" }}>
        <Icon.bell />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-extrabold">Turn on delivery alerts</p>
        <p className="r-muted mt-0.5 text-[13.5px] leading-snug">
          {blocked || "Get notified of new deliveries."}
        </p>
        {!blocked ? (
          <button type="button" className="r-btn r-btn-primary mt-3 min-h-[44px] w-full" disabled={busy} onClick={turnOn}>
            {busy ? "Turning on…" : "Turn on alerts"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- install -- */

let deferred = null;
const listeners = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

const DISMISS_KEY = "kk.rider.installDismissed";

/** "Install KnotKitchen Rider App": shown after sign-in, when the browser offers it, until dismissed. */
export function InstallPrompt() {
  const [, bump] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now() - 7 * 864e5;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  if (!deferred || dismissed) return null;
  const install = async () => {
    const e = deferred;
    deferred = null;
    await e.prompt();
    bump((n) => n + 1);
  };
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode */
    }
    setDismissed(true);
  };
  return (
    <section className="r-card flex items-center gap-3 p-4">
      <img src="/rider/icons/icon-192.png" alt="" className="h-12 w-12 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-extrabold">Install KnotKitchen Rider App</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <button type="button" className="r-btn r-btn-primary min-h-[40px] px-4 text-[14px]" onClick={install}>
          <Icon.download s={16} /> Install
        </button>
        <button type="button" className="r-faint text-[12.5px] font-bold" onClick={dismiss}>
          Not now
        </button>
      </div>
    </section>
  );
}
