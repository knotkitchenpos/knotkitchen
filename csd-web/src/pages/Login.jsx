import React, { useState } from "react";
import { FiArrowRight, FiAlertCircle, FiMail, FiLock, FiShield, FiHeadphones, FiActivity } from "react-icons/fi";
import { auth, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";
import markUrl from "../assets/knotkitchen-mark.png";

/**
 * CSD sign-in.
 *
 * Two halves on a wide screen: the brand panel (the same navy, glow and grid
 * as knotkitchen.com) and the form. On a phone only the form shows. Same
 * fields as ever: email + password, no self-signup.
 */
const POINTS = [
  [FiHeadphones, "Every store, one console", "Orders, menus, billing and chat for each restaurant you support."],
  [FiActivity, "Live, not yesterday's export", "What the till sees is what you see, as it happens."],
  [FiShield, "Every action on the record", "Support work inside a store is logged against your staff ID."],
];

const field =
  "mt-1.5 flex items-center rounded-xl border border-navy-200 bg-navy-50 focus-within:border-brand-500 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-500/15 transition";

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
    <div className="grid min-h-screen w-full bg-white lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <span className="pointer-events-none absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-brand-500/40 blur-3xl animate-drift" aria-hidden="true" />
        <span className="pointer-events-none absolute -bottom-40 -left-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl animate-drift [animation-direction:reverse]" aria-hidden="true" />
        <span
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(70%_60%_at_50%_40%,#000,transparent)]"
          aria-hidden="true"
        />

        <div className="relative flex items-center gap-3 animate-fade-up">
          <img src={markUrl} alt="" className="h-10 w-10 object-contain" />
          <div className="text-lg font-extrabold">
            Knot<span className="text-brand-400">Kitchen</span>
            <span className="ml-2 rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy-200">
              Support Desk
            </span>
          </div>
        </div>

        <div className="relative max-w-lg">
          <h2 className="text-4xl font-extrabold leading-[1.08] tracking-tight animate-fade-up [animation-delay:120ms]">
            Keep every kitchen{" "}
            <span className="bg-gradient-to-r from-brand-300 via-brand-500 to-rose-400 bg-clip-text text-transparent">running.</span>
          </h2>
          <ul className="mt-10 space-y-5">
            {POINTS.map(([Icon, title, text], i) => (
              <li key={title} className="flex gap-4 animate-fade-up" style={{ animationDelay: `${240 + i * 110}ms` }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/5 text-brand-300">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-navy-300">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-navy-400">&copy; {new Date().getFullYear()} KnotKitchen · Staff access only</p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center bg-navy-50 px-4 py-10 lg:bg-white">
        <div className="w-full max-w-md animate-fade-up">
          <div className="mb-8 lg:hidden">
            <img src={markUrl} alt="KnotKitchen" className="mb-3 h-12 w-12" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-navy-500">Sign in to the KnotKitchen support panel.</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <label className="block">
              <span className="text-sm font-semibold text-navy-800">Email</span>
              <div className={field}>
                <FiMail className="mx-3 text-navy-400" aria-hidden="true" />
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  className="w-full border-0 bg-transparent py-3 pr-3 text-navy-900 placeholder-navy-300 !shadow-none focus:outline-none"
                  placeholder="you@knotkitchen.com"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-navy-800">Password</span>
              <div className={field}>
                <FiLock className="mx-3 text-navy-400" aria-hidden="true" />
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className="w-full border-0 bg-transparent py-3 pr-3 text-navy-900 placeholder-navy-300 !shadow-none focus:outline-none"
                  placeholder="••••••••"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3.5 font-semibold text-white shadow-glow hover:brightness-110 disabled:opacity-60 disabled:shadow-none"
            >
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <FiArrowRight aria-hidden="true" />}
            </button>

            <p className="text-center text-xs text-navy-500">No self-signup. Accounts are created by an administrator.</p>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Login;
