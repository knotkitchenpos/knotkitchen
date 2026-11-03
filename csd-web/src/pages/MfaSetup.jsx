import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { FiAlertCircle, FiShield } from "react-icons/fi";
import { auth, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * Two-factor sign-in setup (security audit, 2026-11-03). Every CSD account
 * needs it: the server lets an account without it reach nothing else
 * (middlewares/csdAuth.js), so this page stands in for the whole panel until
 * it is done. Scan the QR code with an authenticator app, enter the code.
 */
const MfaSetup = () => {
  const { staff, setStaff, signOut } = useAuth();
  const [setup, setSetup] = useState(null); // { secret, otpauthUrl }
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    auth.mfaSetup().then(setSetup).catch((err) => setError(errorMessage(err, "Could not start the setup.")));
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      setStaff(await auth.mfaEnable(code));
    } catch (err) {
      setError(errorMessage(err, "That code is not right."));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-navy-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <FiShield size={20} aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-extrabold text-navy-900">Set up two-factor sign-in</h1>
            <p className="text-sm text-navy-500">{staff?.email}</p>
          </div>
        </div>
        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-navy-700">
          <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy).</li>
          <li>Add an account and scan this QR code.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        {setup ? (
          <div className="mt-5 flex flex-col items-center gap-2">
            <div className="rounded-xl border border-navy-200 bg-white p-3">
              <QRCodeSVG value={setup.otpauthUrl} size={180} />
            </div>
            <p className="text-center text-xs text-navy-500">
              Can&apos;t scan? Enter this key in the app:
              <span className="mt-1 block select-all break-all font-mono text-sm font-bold text-navy-900">{setup.secret}</span>
            </p>
          </div>
        ) : (
          !error && <p className="mt-5 text-center text-sm text-navy-400">Preparing…</p>
        )}
        <form onSubmit={submit} className="mt-5 space-y-3">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy || !setup}
            placeholder="6-digit code"
            aria-label="Code from your authenticator app"
            className="w-full rounded-xl border border-navy-200 bg-navy-50 px-3 py-3 text-center font-mono text-lg tracking-[0.4em] text-navy-900 focus:border-brand-500 focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !setup || code.length !== 6}
            className="w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 py-3 font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Checking…" : "Turn on two-factor sign-in"}
          </button>
          <button type="button" onClick={signOut} className="w-full text-center text-xs font-semibold text-navy-500 hover:text-navy-800">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
};

export default MfaSetup;
