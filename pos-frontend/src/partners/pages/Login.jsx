import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { partnersApi, errorMessage } from "../api";

export const inputCls =
  "w-full h-12 px-4 rounded-xl border border-[#E2E8F0] bg-white text-[15px] font-semibold text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#FD5302] focus:outline-none focus:ring-2 focus:ring-[#FD5302]/15";
export const btnPrimary =
  "h-12 px-5 rounded-xl bg-[#FD5302] text-white text-[15px] font-extrabold hover:bg-[#D64502] disabled:opacity-50 transition-colors";

/** Store ID, phone and password: the fields a store's Owner signs into the POS with. */
export const StoreCredentialsFields = ({ value, onChange, autoFocus = false }) => (
  <>
    <label className="block">
      <span className="text-[13px] font-bold text-[#334155]">Store ID</span>
      <input
        className={`${inputCls} mt-1.5`}
        inputMode="numeric"
        autoComplete="username"
        maxLength={6}
        autoFocus={autoFocus}
        placeholder="6-digit Store ID"
        value={value.storeId}
        onChange={(e) => onChange({ ...value, storeId: e.target.value.replace(/\D/g, "").slice(0, 6) })}
      />
    </label>
    <label className="block">
      <span className="text-[13px] font-bold text-[#334155]">Owner phone</span>
      <input
        className={`${inputCls} mt-1.5`}
        inputMode="tel"
        autoComplete="tel-national"
        maxLength={10}
        placeholder="10-digit phone"
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
      />
    </label>
    <label className="block">
      <span className="text-[13px] font-bold text-[#334155]">Password</span>
      <input
        className={`${inputCls} mt-1.5`}
        type="password"
        autoComplete="current-password"
        placeholder="The store's POS password"
        value={value.password}
        onChange={(e) => onChange({ ...value, password: e.target.value })}
      />
    </label>
  </>
);

export const credentialsReady = (v) => /^\d{6}$/.test(v.storeId) && /^\d{10}$/.test(v.phone) && v.password.length > 0;

const Login = () => {
  const [v, setV] = useState({ storeId: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();

  const submit = async (e) => {
    e.preventDefault();
    if (!credentialsReady(v) || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await partnersApi.login(v);
      qc.setQueryData(["partner-me"], res.data.data);
      const next = params.get("next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err, "Could not sign in."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0B1120] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-7">
          <p className="text-[26px] font-extrabold text-white tracking-tight">
            Knot<span className="text-[#FD5302]">Kitchen</span>
          </p>
          <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/50 mt-1">Partners</p>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl p-6 sm:p-7 shadow-2xl space-y-4">
          <div>
            <h1 className="text-[20px] font-extrabold text-[#0F172A]">Owner sign-in</h1>
            <p className="text-[13px] text-[#64748B] mt-1">
              Sign in with one of your stores&apos; Owner login. You can link your other stores once you are in.
            </p>
          </div>
          <StoreCredentialsFields value={v} onChange={setV} autoFocus />
          {error && (
            <p role="alert" className="text-[13px] font-bold text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-xl px-3 py-2.5">
              {error}
            </p>
          )}
          <button type="submit" className={`${btnPrimary} w-full`} disabled={!credentialsReady(v) || busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-[12px] text-[#94A3B8] text-center">
            Only the store&apos;s Owner can sign in here. Forgot the password? Reset it from the POS sign-in or ask KnotKitchen support.
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
