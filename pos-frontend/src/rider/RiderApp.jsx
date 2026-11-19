import React, { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";
import { riderApi } from "./api";
import { connectRiderSocket, disconnectRiderSocket } from "./socket";
import { currentEndpoint, registerWorker } from "./push";
import { useIsDark } from "./theme";
import { Icon } from "./components/ui";
import { Login, Signup, ForgotPin, AccountHold } from "./pages/Auth";
import Home from "./pages/Home";
import DeliveryDetail from "./pages/DeliveryDetail";
import { Deliveries, History } from "./pages/Lists";
import Profile from "./pages/Profile";

/* ---------------------------------------------------------------- shell -- */

function Splash() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4" aria-busy="true">
      <img src="/rider/icons/icon-192.png" alt="" className="h-20 w-20 rounded-[24px]" />
      <p className="text-[18px] font-black" style={{ color: "var(--r-brand)" }}>
        KnotKitchen Rider
      </p>
      <div className="r-skeleton h-1.5 w-32" />
    </div>
  );
}

/** No connection: say so at the top, and that it will catch up by itself. */
function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function OfflineBanner() {
  return (
    <div role="status" className="sticky top-0 z-40 flex items-center justify-center gap-2 px-4 py-2 text-[13.5px] font-extrabold text-white r-safe-top" style={{ background: "var(--r-red)" }}>
      <Icon.wifiOff s={16} /> You’re offline. We’ll catch up when you’re back.
    </div>
  );
}

function BottomNav({ badge }) {
  const tabs = [
    ["/", "Home", Icon.home, true],
    ["/deliveries", "Deliveries", Icon.bike, false],
    ["/history", "History", Icon.list, false],
    ["/profile", "Profile", Icon.user, false],
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t r-safe-bottom" style={{ background: "var(--r-card)", borderColor: "var(--r-line)" }} aria-label="Main">
      <ul className="mx-auto grid max-w-[560px] grid-cols-4">
        {tabs.map(([to, label, I, end]) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className="r-focus relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 pt-1.5 text-[11.5px] font-extrabold"
              style={({ isActive }) => ({ color: isActive ? "var(--r-brand)" : "var(--r-ink-3)" })}
            >
              <I s={23} />
              {label}
              {to === "/deliveries" && badge ? (
                <span className="absolute right-[calc(50%-22px)] top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-black text-white" style={{ background: "var(--r-red)" }} aria-label={`${badge} new`}>
                  {badge}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------- live & ringing -- */

let tone = null;
const RING_MS = 3000; // ring.wav: "ring-ring", then a pause

/**
 * Ring like a phone call while a delivery waits to be accepted: the ring
 * loops and the phone buzzes with each ring, until the rider accepts or
 * rejects (or the store takes it back). Sound and vibration follow the
 * rider's settings. A page nobody has touched yet can't play sound, so the
 * first tap or key starts it.
 */
function useRinging(ringing, prefs) {
  const sound = prefs?.sound !== false;
  const buzz = prefs?.vibration !== false;
  useEffect(() => {
    if (!ringing || (!sound && !buzz)) return undefined;
    let stopped = false;
    const play = () => {
      if (stopped || !sound) return;
      try {
        tone = tone || Object.assign(new Audio("/rider/sounds/ring.wav"), { loop: true, preload: "auto" });
        if (tone.paused) tone.play().catch(() => {});
      } catch {
        /* no audio */
      }
    };
    const vibrate = () => buzz && navigator.vibrate?.([400, 200, 400]);
    play();
    vibrate();
    const timer = setInterval(vibrate, RING_MS);
    window.addEventListener("pointerdown", play);
    window.addEventListener("keydown", play);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("pointerdown", play);
      window.removeEventListener("keydown", play);
      navigator.vibrate?.(0);
      if (tone) {
        tone.pause();
        tone.currentTime = 0;
      }
    };
  }, [ringing, sound, buzz]);
}

/** Socket events and push messages: refresh, and ring when something new arrives. */
function useLive() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const seen = useRef(null);

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["active"] });
    qc.invalidateQueries({ queryKey: ["me"] });
    qc.invalidateQueries({ queryKey: ["delivery"] });
  }, [qc]);

  // Ring when the set of "assigned" deliveries gains one.
  const active = qc.getQueryData(["active"]);
  useEffect(() => {
    const ids = new Set((active?.deliveries || []).filter((d) => d.stage === "assigned").map((d) => d.orderId));
    if (seen.current) {
      const fresh = [...ids].filter((id) => !seen.current.has(id));
      if (fresh.length) {
        enqueueSnackbar("New delivery assigned 🚴", { variant: "info" });
      }
    }
    seen.current = ids;
  }, [active, enqueueSnackbar]);

  useEffect(() => {
    const socket = connectRiderSocket();
    const onDelivery = () => refresh();
    const onAccount = () => qc.invalidateQueries({ queryKey: ["me"] });
    socket.on("delivery:updated", onDelivery);
    socket.on("rider:account", onAccount);
    socket.on("connect", refresh);
    // A push arrived while open, or a notification was tapped.
    const onMessage = (e) => {
      if (e.data?.type === "rider-push") refresh();
      if (e.data?.type === "rider-open" && typeof e.data.url === "string" && e.data.url.startsWith("/rider/")) {
        navigate(e.data.url.slice("/rider".length) || "/");
      }
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      socket.off("delivery:updated", onDelivery);
      socket.off("rider:account", onAccount);
      socket.off("connect", refresh);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc, refresh, navigate]);
}

function SignedIn({ me, onLogout }) {
  useLive();
  const active = useQuery({ queryKey: ["active"], queryFn: riderApi.active, refetchInterval: 60_000 });
  const badge = (active.data?.deliveries || []).filter((d) => d.stage === "assigned").length;
  useRinging(badge > 0, me.prefs);
  return (
    <>
      <main className="mx-auto w-full max-w-[560px] pb-[84px]">
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/deliveries" element={<Deliveries me={me} />} />
          <Route path="/delivery/:id" element={<DeliveryDetail />} />
          <Route path="/history" element={<History />} />
          <Route path="/profile" element={<Profile me={me} onLogout={onLogout} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav badge={badge} />
    </>
  );
}

/* ------------------------------------------------------------------ app -- */

export default function RiderApp() {
  const dark = useIsDark();
  const online = useOnline();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: riderApi.me, retry: (n, err) => err?.response?.status !== 401 && n < 2,
    // Waiting for approval: look again every 20 seconds, so it opens by itself.
    refetchInterval: (q) => (q.state.data?.rider?.status === "pending" ? 20_000 : 5 * 60_000),
  });
  const rider = me.data?.rider;
  const signedOut = me.isError && me.error?.response?.status === 401;

  useEffect(() => {
    document.documentElement.style.background = dark ? "#0b0f17" : "#f6f7fb";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0f17" : "#FD5302");
  }, [dark]);

  // The service worker: the offline shell, and alerts.
  useEffect(() => {
    registerWorker().catch(() => {});
  }, []);

  // Any 401 later on (session expired, signed out elsewhere, PIN reset): back to sign-in.
  useEffect(() => {
    const out = () => {
      disconnectRiderSocket();
      qc.setQueryData(["me"], undefined);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      qc.invalidateQueries({ queryKey: ["me"] });
    };
    window.addEventListener("rider:signed-out", out);
    return () => window.removeEventListener("rider:signed-out", out);
  }, [qc]);

  const logout = useCallback(async () => {
    try {
      await riderApi.logout(await currentEndpoint());
    } catch {
      /* signed out locally either way */
    }
    disconnectRiderSocket();
    qc.clear();
    navigate("/login", { replace: true });
    qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc, navigate]);

  let body;
  if (me.isLoading) body = <Splash />;
  else if (signedOut || !rider) {
    body = signedOut ? (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot" element={<ForgotPin />} />
        <Route path="*" element={<Navigate to={`/login${location.pathname !== "/" ? `?next=${encodeURIComponent(location.pathname)}` : ""}`} replace />} />
      </Routes>
    ) : (
      // Not a sign-out: the server or the network is down.
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-[48px]" aria-hidden="true">
          {online ? "🛠️" : "📶"}
        </div>
        <p className="text-[19px] font-black">{online ? "Can't reach KnotKitchen" : "You're offline"}</p>
        <p className="r-muted max-w-[300px] text-[15px]">{online ? "The server isn't answering right now. Try again in a moment." : "Check your mobile data or Wi-Fi."}</p>
        <button type="button" className="r-btn r-btn-primary mt-2" onClick={() => me.refetch()}>
          <Icon.refresh s={18} /> Try again
        </button>
      </div>
    );
  } else if (rider.status === "pending") {
    body = <AccountHold rider={rider} onRefresh={() => me.refetch()} onLogout={logout} />;
  } else if (["/login", "/signup", "/forgot"].includes(location.pathname)) {
    body = <Navigate to="/" replace />;
  } else {
    body = <SignedIn me={rider} onLogout={logout} />;
  }

  return (
    <div className={`rider ${dark ? "dark" : ""}`}>
      {!online ? <OfflineBanner /> : null}
      {body}
    </div>
  );
}
