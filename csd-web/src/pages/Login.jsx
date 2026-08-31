import React, { useState } from "react";
import { FiArrowRight, FiAlertCircle, FiMail, FiLock } from "react-icons/fi";
import { auth, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import markUrl from "../assets/knotkitchen-mark.png";

/**
 * CSD sign-in.
 *
 * Migrated 2026-08-30 from a two-step phone + OTP flow (which depended on
 * Fast2SMS) to a single-step email + password form. The panel is staff-only
 * and provisioned by an admin, so there is no signup link — a "forgot
 * password" flow is a to-do; until it ships, the seeded super-admin can
 * regenerate its own password via RESET_SUPERADMIN_PASSWORD=true on the
 * server, and other accounts get a new password from an admin.
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
      // The server decides the role; the SPA never infers it here.
      setStaff(await auth.login(email.trim().toLowerCase(), password));
    } catch (err) {
      setError(errorMessage(err, "Invalid email or password."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8 text-center">
          <img src={markUrl} alt="KnotKitchen" className="h-14 w-14 mb-3" />
          <h1 className="text-2xl font-bold text-white">KnotKitchen Business</h1>
          <p className="text-sm text-navy-300 mt-1">Sign in to the support panel.</p>
        </div>

        <form
          onSubmit={submit}
          className="bg-navy-900 border border-navy-700 rounded-2xl p-6 shadow-lg space-y-5"
        >
          {error && (
            <div
              className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
              role="alert"
            >
              <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <label className="block">
            <span className="text-sm font-medium text-navy-100">Email</span>
            <div className="mt-1 flex items-center rounded-lg border border-navy-700 bg-navy-950 focus-within:border-blue-500">
              <FiMail className="mx-3 text-navy-400" aria-hidden="true" />
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                className="w-full bg-transparent py-2.5 pr-3 text-white placeholder-navy-500 focus:outline-none"
                placeholder="you@knotkitchen.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-navy-100">Password</span>
            <div className="mt-1 flex items-center rounded-lg border border-navy-700 bg-navy-950 focus-within:border-blue-500">
              <FiLock className="mx-3 text-navy-400" aria-hidden="true" />
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                className="w-full bg-transparent py-2.5 pr-3 text-white placeholder-navy-500 focus:outline-none"
                placeholder="••••••••"
              />
            </div>
          </label>

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 font-medium text-white disabled:opacity-60 hover:bg-blue-500"
          >
            {busy ? "Signing in…" : "Sign in"}
            {!busy && <FiArrowRight aria-hidden="true" />}
          </button>

          <p className="text-xs text-navy-400 text-center">
            No self-signup — accounts are created by an administrator.
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
