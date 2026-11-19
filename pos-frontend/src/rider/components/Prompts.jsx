import React, { useEffect, useState } from "react";
import { useSnackbar } from "notistack";
import { enablePush, isStandalone, pushState } from "../push";
import { Icon, Sheet } from "./ui";
import { ANDROID_APP_URL, inApp, isAndroidBrowser } from "../native";

/*
 * Notifications: a popup after sign-in (once per app open) and a card on
 * Home until they're on. A browser only lets a site ask once: when the
 * rider has blocked it, the popup shows how to allow it again instead.
 */

const BLOCKERS = {
  denied: "Notifications are blocked for this site.",
  "ios-install": "On iPhone, add this app to your Home Screen first, then open it from there.",
  unsupported: "This browser can't show delivery alerts. Use Chrome on Android.",
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

const SEEN_KEY = "kk.rider.alertsAsked";
const askedThisOpen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
};
const markAsked = () => {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode */
  }
};

function Steps({ items }) {
  return (
    <ol className="mt-1 space-y-2.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-snug">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-black text-white" style={{ background: "var(--r-brand)" }}>
            {i + 1}
          </span>
          <span className="pt-0.5 font-semibold">{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** The card on Home and the popup it opens (on its own once per app open). */
export function AlertsPrompt() {
  const { enqueueSnackbar } = useSnackbar();
  const [state, setState] = usePushState();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // The Android app has its own alerts (RiderService): no browser prompt there.
  const needed = !inApp() && state !== "on" && state !== "checking" && state !== "unsupported";

  useEffect(() => {
    if (needed && !askedThisOpen()) {
      markAsked();
      setOpen(true);
    }
    if (state === "on") setOpen(false);
  }, [needed, state]);

  if (inApp() || state === "on" || state === "checking") return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      setState("on");
      setOpen(false);
      enqueueSnackbar("Delivery alerts are on 🔔", { variant: "success" });
    } catch (err) {
      setState(err?.code || "off");
      if (err?.code !== "denied") enqueueSnackbar(BLOCKERS[err?.code] || "Couldn't turn alerts on. Try again.", { variant: "warning" });
    } finally {
      setBusy(false);
    }
  };
  // After allowing it in the browser's settings: finish here.
  const recheck = async () => {
    setBusy(true);
    try {
      const now = await pushState();
      if (now === "denied") enqueueSnackbar("Still blocked. Allow Notifications for knotkitchen.com, then try again.", { variant: "warning" });
      setState(now);
      if (now === "off") await turnOn();
    } finally {
      setBusy(false);
    }
  };
  const installed = isStandalone();

  return (
    <>
      <section className="r-card flex items-center gap-3 p-4" style={{ borderColor: "var(--r-amber)" }}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ background: "var(--r-amber-soft)", color: "var(--r-amber)" }}>
          <Icon.bell />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-extrabold">Delivery alerts are off</p>
          <p className="r-muted text-[13.5px] leading-snug">{BLOCKERS[state] || "You won't hear about new deliveries."}</p>
        </div>
        {state !== "unsupported" ? (
          <button type="button" className="r-btn r-btn-primary min-h-[44px] shrink-0 px-4 text-[14px]" onClick={() => setOpen(true)}>
            Turn on
          </button>
        ) : null}
      </section>

      <Sheet open={open} onClose={() => setOpen(false)} title={state === "denied" ? "Notifications are blocked" : "Turn on notifications"} labelledBy="r-alerts-title">
        <div className="mb-4 flex justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-[22px] text-[32px]" style={{ background: "var(--r-amber-soft)" }} aria-hidden="true">
            🔔
          </span>
        </div>
        {state === "denied" ? (
          <>
            <Steps
              items={
                installed
                  ? ["Long-press the KK Rider icon and tap App info.", "Tap Notifications and switch them on.", "Come back and tap “I’ve allowed it”."]
                  : ["Tap the icon to the left of knotkitchen.com in the address bar.", "Tap Permissions, then Notifications, and choose Allow.", "Come back and tap “I’ve allowed it”."]
              }
            />
            <button type="button" className="r-btn r-btn-primary r-btn-lg mt-5 w-full" disabled={busy} onClick={recheck}>
              {busy ? "Checking…" : "I’ve allowed it"}
            </button>
          </>
        ) : state === "ios-install" ? (
          <Steps items={["Tap Share in Safari.", "Tap Add to Home Screen.", "Open KK Rider from your Home Screen and turn on notifications."]} />
        ) : (
          <>
            <p className="r-muted text-center text-[15px]">Get a notification the moment you’re given a delivery, even with the app closed.</p>
            <button type="button" className="r-btn r-btn-primary r-btn-lg mt-5 w-full" disabled={busy} onClick={turnOn}>
              {busy ? "Turning on…" : "Turn on notifications"}
            </button>
          </>
        )}
        <button type="button" className="r-faint mt-3 w-full py-2 text-[14px] font-bold" onClick={() => setOpen(false)}>
          Not now
        </button>
      </Sheet>
    </>
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

/** In a phone's browser: the Android app rings for deliveries even when it's closed. */
export function AndroidAppCard() {
  if (!isAndroidBrowser()) return null;
  return (
    <a href={ANDROID_APP_URL} className="r-card r-focus flex items-center gap-3 p-4">
      <img src="/rider/icons/icon-192.png" alt="" className="h-12 w-12 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-extrabold">Get the KK Rider app</p>
        <p className="r-muted text-[13px]">Rings for new deliveries even when it&apos;s closed.</p>
      </div>
      <span className="r-btn r-btn-primary min-h-[40px] px-4 text-[14px]">
        <Icon.download s={16} /> Get
      </span>
    </a>
  );
}
