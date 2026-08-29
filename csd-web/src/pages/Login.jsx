import React, { useEffect, useRef, useState } from "react";
import { FiArrowRight, FiAlertCircle, FiSmartphone, FiLock, FiArrowLeft } from "react-icons/fi";
import { auth, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import markUrl from "../assets/knotkitchen-mark.png";

const RESEND_SECONDS = 60; // matches otpService's per-number cooldown

const Login = () => {
  const { setStaff } = useAuth();
  const [step, setStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [masked, setMasked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef(null);

  useEffect(() => {
    if (!cooldown) return undefined;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === 2) otpRef.current?.focus();
  }, [step]);

  const submitPhone = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { maskedPhone } = await auth.sendOtp(phone);
      setMasked(maskedPhone);
      setCooldown(RESEND_SECONDS);
      setStep(2);
    } catch (err) {
      setError(errorMessage(err, "Could not send the code."));
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      // The server decides the role; the SPA never infers it from the phone.
      setStaff(await auth.verifyOtp(phone, otp));
    } catch (err) {
      setError(errorMessage(err, "Could not verify the code."));
      setOtp("");
      otpRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown) return;
    setError("");
    setBusy(true);
    try {
      const { maskedPhone } = await auth.sendOtp(phone);
      setMasked(maskedPhone);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errorMessage(err, "Could not resend the code."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <img src={markUrl} alt="" className="w-24 h-24 object-contain" />
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
            <span className="text-white">Knot</span>
            <span className="text-brand-500">Kitchen</span>
          </h1>
          <p className="mt-1 text-sm font-medium text-navy-300">Business — Operations Panel</p>
        </div>

        <div className="rounded-2xl border border-navy-700 bg-navy-900/80 p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center gap-3 mb-6 text-xs font-semibold">
            <span className={step >= 1 ? "text-brand-500" : "text-navy-400"}>1 Phone</span>
            <span className={`h-px flex-1 ${step >= 2 ? "bg-brand-500" : "bg-navy-700"}`} />
            <span className={step >= 2 ? "text-brand-500" : "text-navy-400"}>2 Verify</span>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
            >
              <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {step === 1 ? (
            <form onSubmit={submitPhone} className="space-y-5">
              <div>
                <label htmlFor="phone" className="block text-xs font-semibold uppercase tracking-wider text-navy-300 mb-2">
                  Registered phone number
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-navy-700 bg-navy-950 px-4 py-3 focus-within:border-brand-500">
                  <FiSmartphone className="shrink-0 text-navy-400" aria-hidden="true" />
                  <span className="text-navy-400 text-sm select-none">+91</span>
                  <input
                    id="phone"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    value={phone}
                    onChange={(e) => {
                      setError("");
                      setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                    }}
                    placeholder="10-digit number"
                    className="w-full bg-transparent text-white outline-none placeholder:text-navy-500"
                    autoFocus
                    required
                  />
                </div>
                <p className="mt-2 text-xs text-navy-400">
                  Only numbers registered by a KnotKitchen administrator can sign in.
                </p>
              </div>

              <button
                type="submit"
                disabled={busy || phone.length !== 10}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                {busy ? "Sending code…" : "Send code"}
                {!busy && <FiArrowRight aria-hidden="true" />}
              </button>
            </form>
          ) : (
            <form onSubmit={submitOtp} className="space-y-5">
              <div>
                <label htmlFor="otp" className="block text-xs font-semibold uppercase tracking-wider text-navy-300 mb-2">
                  Enter the 6-digit code
                </label>
                <div className="flex items-center gap-3 rounded-xl border border-navy-700 bg-navy-950 px-4 py-3 focus-within:border-brand-500">
                  <FiLock className="shrink-0 text-navy-400" aria-hidden="true" />
                  <input
                    id="otp"
                    ref={otpRef}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otp}
                    onChange={(e) => {
                      setError("");
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                    }}
                    placeholder="••••••"
                    className="w-full bg-transparent font-mono tracking-[0.4em] text-white outline-none placeholder:text-navy-600 placeholder:tracking-normal"
                    required
                  />
                </div>
                <p className="mt-2 text-xs text-navy-400">Sent to {masked}</p>
              </div>

              <button
                type="submit"
                disabled={busy || otp.length < 4}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 font-semibold text-white transition hover:bg-brand-500 disabled:opacity-50"
              >
                {busy ? "Verifying…" : "Verify & sign in"}
                {!busy && <FiArrowRight aria-hidden="true" />}
              </button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setOtp("");
                    setError("");
                  }}
                  className="inline-flex items-center gap-1.5 text-navy-300 hover:text-white"
                >
                  <FiArrowLeft aria-hidden="true" /> Change number
                </button>
                <button
                  type="button"
                  onClick={resend}
                  disabled={!!cooldown || busy}
                  className="text-brand-400 hover:text-brand-300 disabled:text-navy-500"
                >
                  {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-navy-500">
          &copy; {new Date().getFullYear()} KnotKitchen Inc. Internal use only.
        </p>
      </div>
    </div>
  );
};

export default Login;
