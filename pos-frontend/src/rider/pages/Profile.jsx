import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";
import { riderApi, errorMessage } from "../api";
import { disablePush, enablePush } from "../push";
import { usePushState } from "../components/Prompts";
import { Confirm, Icon, Pill, PinField, Sheet, Toggle, TopBar } from "../components/ui";
import { useTheme } from "../theme";
import { ANDROID_APP_URL, inApp } from "../native";

const STATUS_TONE = { active: "green", pending: "amber", suspended: "red", deactivated: "grey" };
const PUSH_NOTE = {
  denied: "Blocked in your browser's site settings.",
  "ios-install": "Add to Home Screen first (iPhone).",
  unsupported: "Not available in this browser.",
};

function Row({ icon, label, note, children }) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
      <span className="r-faint">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-bold">{label}</p>
        {note ? <p className="r-faint text-[12.5px] font-semibold">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

export default function Profile({ me, onLogout }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [theme, setTheme] = useTheme();
  const [push, setPush] = usePushState();
  const [pushBusy, setPushBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const prefs = useMutation({
    mutationFn: (p) => riderApi.updateMe({ prefs: p }),
    onSuccess: (res) => qc.setQueryData(["me"], res),
    onError: (err) => enqueueSnackbar(errorMessage(err), { variant: "error" }),
  });

  const setNotifications = async (on) => {
    setPushBusy(true);
    try {
      if (on) {
        await enablePush();
        setPush("on");
        enqueueSnackbar("Delivery alerts are on 🔔", { variant: "success" });
      } else {
        await disablePush();
        setPush("off");
        enqueueSnackbar("Delivery alerts are off on this phone.", { variant: "info" });
      }
    } catch (err) {
      setPush(err?.code || "off");
      enqueueSnackbar(PUSH_NOTE[err?.code] || errorMessage(err), { variant: "warning" });
    } finally {
      setPushBusy(false);
    }
  };
  // What really happened, so a missing notification can be put right.
  const test = async () => {
    try {
      const r = await riderApi.pushTest();
      if (r.sent) {
        enqueueSnackbar(`Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}. Nothing within a minute? Allow notifications for Chrome in your phone's settings and set battery to Unrestricted.`, { variant: "success", autoHideDuration: 9000 });
      } else if (r.failed) {
        enqueueSnackbar(`The notification service refused it: ${r.errors?.[0] || "unknown error"}. Turn Notifications off and on again.`, { variant: "error", autoHideDuration: 9000 });
      } else {
        enqueueSnackbar("This phone isn't registered for notifications. Turn Notifications off and on again.", { variant: "warning", autoHideDuration: 9000 });
      }
    } catch (err) {
      enqueueSnackbar(errorMessage(err), { variant: "error" });
    }
  };

  const initials = String(me.name || "R")
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="px-4 pb-8">
      <TopBar title="My Profile" />
      <section className="r-card p-5">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-[22px] text-[24px] font-black text-white" style={{ background: "var(--r-brand)" }}>
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[21px] font-black">{me.name}</p>
            <p className="r-muted text-[15px] font-semibold">{me.phone}</p>
            <Pill tone={STATUS_TONE[me.status]} className="mt-1 capitalize">
              {me.status}
            </Pill>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-[14px]">
          {[
            ["Store", me.storeName || "-"],
            ["Store ID", me.storeId],
            ["Joined", me.joinedAt ? new Date(me.joinedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-"],
            ["Account", me.status === "active" ? "Active" : me.status],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl p-3" style={{ background: "var(--r-card-2)" }}>
              <dt className="r-faint text-[12px] font-bold">{k}</dt>
              <dd className="truncate font-extrabold capitalize">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <h2 className="r-faint mb-2 mt-6 px-1 text-[12px] font-extrabold uppercase tracking-widest">Settings</h2>
      <section className="r-card divide-y" style={{ borderColor: "var(--r-line)" }}>
        <Row icon={<Icon.bell />} label="Notifications" note={push === "on" ? "On" : PUSH_NOTE[push] || "Off"}>
          <Toggle checked={push === "on"} disabled={pushBusy || Boolean(PUSH_NOTE[push]) || push === "checking"} onChange={setNotifications} label="Delivery notifications" />
        </Row>
        {push === "on" ? (
          <div className="px-4 py-2">
            <button type="button" className="text-[14px] font-extrabold" style={{ color: "var(--r-brand-ink)" }} onClick={test}>
              Send a test notification
            </button>
          </div>
        ) : null}
        <Row icon={<Icon.sound />} label="Sound">
          <Toggle checked={me.prefs?.sound !== false} disabled={prefs.isPending} onChange={(v) => prefs.mutate({ sound: v })} label="Sound" />
        </Row>
        <Row icon={<Icon.vibrate />} label="Vibration">
          <Toggle checked={me.prefs?.vibration !== false} disabled={prefs.isPending} onChange={(v) => prefs.mutate({ vibration: v })} label="Vibration" />
        </Row>
        <Row icon={<Icon.moon />} label="Dark Mode">
          <div className="flex rounded-full p-1" style={{ background: "var(--r-card-2)" }} role="radiogroup" aria-label="Theme">
            {[
              ["light", "Light"],
              ["system", "Auto"],
              ["dark", "Dark"],
            ].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={theme === k} onClick={() => setTheme(k)} className="r-focus min-h-[34px] rounded-full px-3 text-[12.5px] font-extrabold" style={{ background: theme === k ? "var(--r-card)" : "transparent", color: theme === k ? "var(--r-ink)" : "var(--r-ink-3)" }}>
                {l}
              </button>
            ))}
          </div>
        </Row>
        {!inApp() ? (
          <a href={ANDROID_APP_URL} className="r-focus block">
            <Row icon={<Icon.download />} label="Android app" note="Rings for new deliveries even when it's closed">
              <Icon.chevron className="r-faint" />
            </Row>
          </a>
        ) : null}
        <button type="button" className="r-focus w-full text-left" onClick={() => setPinOpen(true)}>
          <Row icon={<Icon.lock />} label="Change PIN">
            <Icon.chevron className="r-faint" />
          </Row>
        </button>
        <button type="button" className="r-focus w-full text-left" onClick={() => setLogoutOpen(true)}>
          <Row icon={<span style={{ color: "var(--r-red)" }}><Icon.logout /></span>} label="Logout">
            <Icon.chevron className="r-faint" />
          </Row>
        </button>
      </section>

      <ChangePin open={pinOpen} onClose={() => setPinOpen(false)} />
      <Confirm
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        title="Log out?"
        body={me.online ? "You'll go offline on this phone and stop getting deliveries here." : "You'll need your PIN to sign in again."}
        confirmLabel="Logout"
        tone="danger"
        busy={loggingOut}
        onConfirm={async () => {
          setLoggingOut(true);
          await onLogout();
        }}
      />
    </div>
  );
}

function ChangePin({ open, onClose }) {
  const { enqueueSnackbar } = useSnackbar();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const m = useMutation({
    mutationFn: () => riderApi.changePin({ currentPin: current, newPin: next }),
    onSuccess: () => {
      enqueueSnackbar("PIN changed. Other phones will need the new PIN.", { variant: "success" });
      setCurrent("");
      setNext("");
      setAgain("");
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Sheet open={open} onClose={onClose} title="Change PIN">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          if (next !== again) return setError("The new PINs don't match.");
          m.mutate();
        }}
      >
        <PinField id="r-cur-pin" label="Current PIN" value={current} onChange={setCurrent} autoFocus />
        <PinField id="r-next-pin" label="New PIN" value={next} onChange={setNext} />
        <PinField id="r-again-pin" label="Confirm new PIN" value={again} onChange={setAgain} />
        {error ? (
          <p role="alert" className="rounded-2xl px-4 py-3 text-[14px] font-bold" style={{ background: "var(--r-red-soft)", color: "var(--r-red)" }}>
            {error}
          </p>
        ) : null}
        <button type="submit" className="r-btn r-btn-primary w-full" disabled={m.isPending || current.length < 4 || next.length < 4 || again.length < 4}>
          {m.isPending ? "Saving…" : "Change PIN"}
        </button>
      </form>
    </Sheet>
  );
}
