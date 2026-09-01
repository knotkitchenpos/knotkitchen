import React, { useState } from "react";
import { FiArrowRight, FiAlertCircle, FiMail, FiLock } from "react-icons/fi";
import { auth, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import markUrl from "../assets/knotkitchen-mark.png";

/**
 * CSD sign-in.
 *
 * Repainted 2026-09-01 to match the agreement portal's light palette
 * (F6F8F7 canvas, white card, FF6B00 accent) so operators moving between
 * the two panels have a consistent look. Same fields as before —
 * email + password only; no self-signup.
 */
const Login = () => {
  const { setStaff } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setStaff(await auth.login(email.trim().toLowerCase(), password));
    } catch (err) {
      setError(errorMessage(err, "Invalid email or password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[#F6F8F7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <img src={markUrl} alt="KnotKitchen" className="h-14 w-14 mb-3" />
          <h1 className="text-2xl font-bold text-[#14201C]">KnotKitchen Business</h1>
          <p className="text-sm text-[#6B7280] mt-1">Sign in to the support panel.</p>
        </div>

        <form
          onSubmit={submit}
          className="bg-white border border-[#E5E7EB] rounded-3xl p-6 sm:p-8 shadow-[0_10px_30px_rgba(20,32,28,0.06)] space-y-5"
        >
          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-semibold text-[#14201C]">Email</span>
            <div className="mt-1.5 flex items-center rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] focus-within:border-[#FF6B00] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#FF6B00]/15 transition">
              <FiMail className="mx-3 text-[#94A3B8]" aria-hidden="true" />
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="w-full bg-transparent py-2.5 pr-3 text-[#14201C] placeholder-[#9CA3AF] focus:outline-none"
                placeholder="you@knotkitchen.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-[#14201C]">Password</span>
            <div className="mt-1.5 flex items-center rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] focus-within:border-[#FF6B00] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#FF6B00]/15 transition">
              <FiLock className="mx-3 text-[#94A3B8]" aria-hidden="true" />
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="w-full bg-transparent py-2.5 pr-3 text-[#14201C] placeholder-[#9CA3AF] focus:outline-none"
                placeholder="••••••••"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FF6B00] py-3 font-semibold text-white shadow-sm disabled:opacity-60 hover:bg-[#e55f00] transition"
          >
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <FiArrowRight aria-hidden="true" />}
          </button>

          <p className="text-xs text-[#6B7280] text-center">
            No self-signup — accounts are created by an administrator.
          </p>
        </form>

        <p className="mt-6 text-center text-xs text-[#94A3B8]">
          &copy; {new Date().getFullYear()} KnotKitchen Inc.
        </p>
      </div>
    </div>
  );
};

export default Login;
