import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { riderApi, errorMessage } from "../api";
import { Icon, PinField } from "../components/ui";
import { ANDROID_APP_URL, inApp } from "../native";

const digits10 = (v) => v.replace(/\D/g, "").slice(0, 10);

/**
 * What a store's invite or PIN-reset link carries after "#" (Settings >
 * Delivery Riders): s Store ID, n name, p phone, c code. Read once, then
 * taken off the address bar so the code isn't left in the history.
 */
let linkFill = null; // once per page load: React may run a state initializer twice
const readLinkFill = () => {
  if (linkFill) return linkFill;
  if (typeof window === "undefined" || !window.location.hash.slice(1)) return {};
  const h = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  const fill = {
    storeId: (h.get("s") || "").replace(/\D/g, "").slice(0, 6),
    name: (h.get("n") || "").slice(0, 60),
    phone: digits10(h.get("p") || ""),
    code: (h.get("c") || "").replace(/\D/g, "").slice(0, 6),
  };
  linkFill = Object.fromEntries(Object.entries(fill).filter(([, v]) => v));
  return linkFill;
};

// Letter-spaced digits only once typed: a spaced-out placeholder reads "6 d i g i t s".
const spaced = (value, cls) => `r-input ${value ? cls : ""}`;

function Shell({ title, subtitle, children, back }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-5 r-safe-top r-safe-bottom">
      <div className="flex h-14 items-center">
        {back ? (
          <Link to={back} aria-label="Back" className="r-focus flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--r-card)" }}>
            <Icon.back />
          </Link>
        ) : null}
      </div>
      <div className="mb-6 mt-2 flex items-center gap-3">
        <img src="/rider/icons/icon-192.png" alt="" className="h-14 w-14 rounded-2xl" />
        <div>
          <p className="text-[13px] font-extrabold uppercase tracking-widest" style={{ color: "var(--r-brand-ink)" }}>
            KnotKitchen Rider
          </p>
          <h1 className="text-[26px] font-black leading-tight">{title}</h1>
        </div>
      </div>
      {subtitle ? <p className="r-muted -mt-3 mb-5 text-[15px] leading-relaxed">{subtitle}</p> : null}
      {children}
      {!inApp() ? (
        <a
          href={ANDROID_APP_URL}
          className="r-focus mt-auto flex items-center justify-center gap-2 pt-8 text-[14.5px] font-extrabold"
          style={{ color: "var(--r-brand-ink)" }}
        >
          <Icon.download s={18} /> Download the KK Rider Android app
        </a>
      ) : null}
    </main>
  );
}

function FormError({ message }) {
  return message ? (
    <p role="alert" className="mt-3 rounded-2xl px-4 py-3 text-[14.5px] font-bold" style={{ background: "var(--r-red-soft)", color: "var(--r-red)" }}>
      {message}
    </p>
  ) : null;
}

/** After signing in: the app reads who it is again. */
const useSignedIn = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (rider) => {
    qc.setQueryData(["me"], { rider });
    qc.invalidateQueries();
    const next = params.get("next");
    navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
  };
};

export function Login() {
  const signedIn = useSignedIn();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const { rider } = await riderApi.login({ phone, pin, remember });
      signedIn(rider);
    } catch (err) {
      setError(errorMessage(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="r-phone" className="r-label">
            Mobile number
          </label>
          <input id="r-phone" className="r-input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(digits10(e.target.value))} />
        </div>
        <PinField id="r-pin" label="PIN" value={pin} onChange={setPin} />
        <label className="flex items-center gap-3 py-1 text-[15px] font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[var(--r-brand)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this device
        </label>
        <FormError message={error} />
        <button type="submit" className="r-btn r-btn-primary r-btn-lg w-full" disabled={busy || phone.length !== 10 || pin.length < 4}>
          {busy ? "Signing in…" : "Login"}
        </button>
      </form>
      <div className="mt-5 flex items-center justify-between text-[15px] font-bold">
        <Link to="/forgot" className="r-focus" style={{ color: "var(--r-brand-ink)" }}>
          Forgot PIN?
        </Link>
        <Link to="/signup" className="r-focus" style={{ color: "var(--r-brand-ink)" }}>
          New rider? Sign up
        </Link>
      </div>
    </Shell>
  );
}

export function Signup() {
  const signedIn = useSignedIn();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => ({ storeId: "", name: "", phone: "", code: "", ...readLinkFill() }));
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: k === "phone" ? digits10(e.target.value) : k === "storeId" || k === "code" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value }));

  const next = (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(form.storeId)) return setError("Store ID is the 6-digit number your restaurant gave you.");
    if (form.name.trim().length < 2) return setError("Enter your name.");
    if (!/^[6-9]\d{9}$/.test(form.phone)) return setError("Enter a valid 10-digit mobile number.");
    setStep(2);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (pin !== pin2) return setError("The two PINs don't match.");
    setBusy(true);
    try {
      const { rider } = await riderApi.signup({ ...form, name: form.name.trim(), pin });
      setDone(rider);
    } catch (err) {
      setError(errorMessage(err));
      if (["STORE_NOT_FOUND", "OTHER_STORE", "ALREADY_REGISTERED", "BAD_PHONE", "BAD_NAME"].includes(err?.response?.data?.code)) setStep(1);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const active = done.status === "active";
    return (
      <Shell title={active ? "You're all set!" : "Signed up"}>
        <div className="r-card p-6 text-center">
          <div className="mb-2 text-[52px]" aria-hidden="true">
            {active ? "🎉" : "⏳"}
          </div>
          <p className="text-[17px] font-extrabold">{active ? `Welcome to ${done.storeName || "the team"}, ${done.name.split(" ")[0]}.` : "Waiting for your store to approve you"}</p>
          <p className="r-muted mt-2 text-[14.5px] leading-relaxed">
            {active ? "Go online to start getting deliveries." : `${done.storeName || "Your restaurant"} will approve your account.`}
          </p>
        </div>
        <button type="button" className="r-btn r-btn-primary r-btn-lg mt-5 w-full" onClick={() => signedIn(done)}>
          Continue
        </button>
      </Shell>
    );
  }

  return step === 1 ? (
    <Shell title="Join as a rider" back="/login">
      <form onSubmit={next} className="space-y-4" noValidate>
        <div>
          <label htmlFor="r-store" className="r-label">
            Store ID
          </label>
          <input id="r-store" className={spaced(form.storeId, "tracking-[0.2em]")} inputMode="numeric" placeholder="6 digits, e.g. 231146" value={form.storeId} onChange={set("storeId")} />
        </div>
        <div>
          <label htmlFor="r-name" className="r-label">
            Your name
          </label>
          <input id="r-name" className="r-input" autoComplete="name" placeholder="e.g. Rahul" maxLength={60} value={form.name} onChange={set("name")} />
        </div>
        <div>
          <label htmlFor="r-sphone" className="r-label">
            Mobile number
          </label>
          <input id="r-sphone" className="r-input" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" value={form.phone} onChange={set("phone")} />
        </div>
        <div>
          <label htmlFor="r-code" className="r-label">
            Invite code <span className="r-faint font-semibold">(if your store gave you one)</span>
          </label>
          <input id="r-code" className={spaced(form.code, "tracking-[0.3em]")} inputMode="numeric" placeholder="6 digits" value={form.code} onChange={set("code")} />
        </div>
        <FormError message={error} />
        <button type="submit" className="r-btn r-btn-primary r-btn-lg w-full">
          Next: create PIN
        </button>
      </form>
    </Shell>
  ) : (
    <Shell title="Create your PIN" subtitle="Don't share it with anyone.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        <PinField id="r-new-pin" label="New PIN" value={pin} onChange={setPin} autoFocus />
        <PinField id="r-new-pin2" label="Confirm PIN" value={pin2} onChange={setPin2} />
        <FormError message={error} />
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button type="button" className="r-btn r-btn-ghost" onClick={() => setStep(1)}>
            Back
          </button>
          <button type="submit" className="r-btn r-btn-primary r-btn-lg" disabled={busy || pin.length < 4 || pin2.length < 4}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </div>
      </form>
    </Shell>
  );
}

export function ForgotPin() {
  const signedIn = useSignedIn();
  const [fill] = useState(readLinkFill);
  const [phone, setPhone] = useState(fill.phone || "");
  const [code, setCode] = useState(fill.code || "");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (pin !== pin2) return setError("The two PINs don't match.");
    setBusy(true);
    try {
      const { rider } = await riderApi.resetPin({ phone, code, pin });
      signedIn(rider);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell title="Forgot PIN" subtitle="Ask your store owner for a reset code." back="/login">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="r-fphone" className="r-label">
            Mobile number
          </label>
          <input id="r-fphone" className="r-input" type="tel" inputMode="numeric" placeholder="10-digit mobile" value={phone} onChange={(e) => setPhone(digits10(e.target.value))} />
        </div>
        <div>
          <label htmlFor="r-fcode" className="r-label">
            Reset code from your store
          </label>
          <input id="r-fcode" className={spaced(code, "tracking-[0.3em]")} inputMode="numeric" placeholder="6 digits" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </div>
        <PinField id="r-fpin" label="New PIN" value={pin} onChange={setPin} />
        <PinField id="r-fpin2" label="Confirm new PIN" value={pin2} onChange={setPin2} />
        <FormError message={error} />
        <button type="submit" className="r-btn r-btn-primary r-btn-lg w-full" disabled={busy || phone.length !== 10 || code.length !== 6 || pin.length < 4}>
          {busy ? "Saving…" : "Set new PIN"}
        </button>
      </form>
    </Shell>
  );
}

/** Signed in, not approved yet (or suspended): what's going on and what to do. */
export function AccountHold({ rider, onRefresh, onLogout }) {
  const suspended = rider.status === "suspended";
  return (
    <Shell title={suspended ? "Account suspended" : "Waiting for approval"}>
      <div className="r-card p-6 text-center">
        <div className="mb-2 text-[52px]" aria-hidden="true">
          {suspended ? "⏸️" : "⏳"}
        </div>
        <p className="text-[17px] font-extrabold">
          {suspended ? `${rider.storeName || "Your store"} has paused your deliveries.` : `${rider.storeName || "Your store"} hasn't approved you yet.`}
        </p>
        {suspended && rider.statusNote ? (
          <p className="mt-3 rounded-2xl px-4 py-3 text-[14.5px] font-semibold" style={{ background: "var(--r-card-2)" }}>
            “{rider.statusNote}”
          </p>
        ) : null}
        <p className="r-muted mt-3 text-[14.5px] leading-relaxed">
          {suspended ? "Contact your store owner." : "Ask your store owner to approve you."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-left text-[14px]">
          <div className="rounded-2xl p-3" style={{ background: "var(--r-card-2)" }}>
            <dt className="r-faint font-bold">Store ID</dt>
            <dd className="font-extrabold">{rider.storeId}</dd>
          </div>
          <div className="rounded-2xl p-3" style={{ background: "var(--r-card-2)" }}>
            <dt className="r-faint font-bold">Mobile</dt>
            <dd className="font-extrabold">{rider.phone}</dd>
          </div>
        </dl>
      </div>
      <button type="button" className="r-btn r-btn-primary mt-5 w-full" onClick={onRefresh}>
        <Icon.refresh s={18} /> Check again
      </button>
      <button type="button" className="r-btn r-btn-ghost mt-3 w-full" onClick={onLogout}>
        <Icon.logout s={18} /> Logout
      </button>
    </Shell>
  );
}
