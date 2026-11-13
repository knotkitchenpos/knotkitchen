import React, { useEffect, useState } from "react";
import { MdNotificationsActive, MdNotificationsOff } from "react-icons/md";
import { enqueueSnackbar } from "../../utils/notify";
import { partnersApi, errorMessage } from "../api";
import { alertState, enableAlerts, disableAlerts } from "../push";

/**
 * Phone alerts (owner, 2026-11-13): switch alerts on for this phone or
 * computer, and choose which ones (pos-backend services/partnerAlerts).
 */

const BLOCKERS = {
  "ios-install": "On iPhone, first add Partners to the Home Screen (Share → Add to Home Screen), open it from there, then switch alerts on.",
  unsupported: "This browser cannot show alerts. Use Chrome on Android or a computer, or Safari from the iPhone Home Screen.",
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then come back.",
};

const Toggle = ({ on, onChange, label, hint, children }) => (
  <div className="py-3 flex flex-wrap items-center gap-3">
    <span className="min-w-0 flex-1">
      <span className="block text-[14px] font-bold">{label}</span>
      <span className="block text-[12px] text-[#64748B]">{hint}</span>
    </span>
    {children}
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-12 h-7 rounded-full relative transition-colors ${on ? "bg-[#16A34A]" : "bg-[#CBD5E1]"}`}
    >
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${on ? "left-6" : "left-1"}`} />
    </button>
  </div>
);

const Alerts = () => {
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState(null);

  const load = () =>
    alertState()
      .then((d) => {
        setInfo(d);
        setPrefs(d.prefs);
      })
      .catch((err) => enqueueSnackbar(errorMessage(err, "Could not load alerts."), { variant: "error" }));
  useEffect(() => {
    load();
  }, []);

  const save = async (next) => {
    setPrefs(next);
    try {
      setPrefs((await partnersApi.saveAlerts(next)).data.data.prefs);
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Not saved."), { variant: "error" });
    }
  };

  const toggleDevice = async () => {
    setBusy(true);
    try {
      if (info.state === "on") await disableAlerts();
      else await enableAlerts(info.publicKey);
      await load();
    } catch (err) {
      const code = err?.code;
      enqueueSnackbar(BLOCKERS[code] || errorMessage(err, "Alerts could not be switched on."), { variant: "error" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      const r = (await partnersApi.alertsTest()).data.data;
      enqueueSnackbar(r.sent ? `Test alert sent to ${r.sent} device${r.sent === 1 ? "" : "s"}.` : "No device has alerts on yet.", { variant: r.sent ? "success" : "warning" });
    } catch (err) {
      enqueueSnackbar(errorMessage(err, "Could not send a test."), { variant: "error" });
    }
  };

  const amount = (key) => (
    <label className="flex items-center gap-1 text-[12.5px] font-bold text-[#334155]">
      ₹
      <input
        inputMode="numeric"
        aria-label={key === "walletLowBelow" ? "Wallet below" : "Refund at or above"}
        defaultValue={prefs[key]}
        key={`${key}-${prefs[key]}`}
        onBlur={(e) => Number(e.target.value) !== prefs[key] && save({ ...prefs, [key]: e.target.value })}
        className="h-9 w-24 px-2 rounded-lg border border-[#E2E8F0] text-right"
      />
    </label>
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Phone alerts</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Hear about any of your stores the moment something needs you, even with Partners closed.</p>
      </div>
      {!info || !prefs ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <>
          <section className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              {info.state === "on" ? <MdNotificationsActive size={26} className="text-[#16A34A]" /> : <MdNotificationsOff size={26} className="text-[#94A3B8]" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-extrabold">{info.state === "on" ? "On for this device" : "Off on this device"}</span>
                <span className="block text-[12px] text-[#64748B]">
                  {info.devices} device{info.devices === 1 ? "" : "s"} with alerts on
                </span>
              </span>
              {!BLOCKERS[info.state] && (
                <button type="button" onClick={toggleDevice} disabled={busy} className={`h-10 px-4 rounded-xl text-[13px] font-extrabold disabled:opacity-40 ${info.state === "on" ? "border border-[#E2E8F0] text-[#334155]" : "bg-[#FD5302] text-white"}`}>
                  {busy ? "…" : info.state === "on" ? "Switch off here" : "Switch on here"}
                </button>
              )}
              {info.devices > 0 && (
                <button type="button" onClick={test} className="h-10 px-4 rounded-xl border border-[#E2E8F0] text-[13px] font-bold text-[#334155]">
                  Send a test
                </button>
              )}
            </div>
            {BLOCKERS[info.state] && <p className="mt-3 rounded-xl bg-[#FFFBEB] border border-[#FDE68A] px-3.5 py-2.5 text-[12.5px] font-bold text-[#92400E]">{BLOCKERS[info.state]}</p>}
          </section>

          <section className="bg-white border border-[#E2E8F0] rounded-2xl px-4 sm:px-5 divide-y divide-[#F1F5F9]">
            <Toggle on={prefs.locked} onChange={(v) => save({ ...prefs, locked: v })} label="Store locked" hint="A store stops taking orders because of its wallet or plan." />
            <Toggle on={prefs.walletLow} onChange={(v) => save({ ...prefs, walletLow: v })} label="Wallet low" hint="A store's wallet falls below this amount.">
              {prefs.walletLow && amount("walletLowBelow")}
            </Toggle>
            <Toggle on={prefs.largeRefund} onChange={(v) => save({ ...prefs, largeRefund: v })} label="Large refund" hint="A refund at or above this amount.">
              {prefs.largeRefund && amount("largeRefundAbove")}
            </Toggle>
            <Toggle on={prefs.stockOut} onChange={(v) => save({ ...prefs, stockOut: v })} label="Out of stock" hint="Dishes switched off because an inventory item ran out." />
          </section>
          <p className="text-[12px] text-[#94A3B8]">These settings apply to every device you switch alerts on for.</p>
        </>
      )}
    </div>
  );
};

export default Alerts;
