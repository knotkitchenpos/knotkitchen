import { createContext, useContext, useState } from "react";
import { api, ApiError } from "./api.js";
import { Err, Field, Modal } from "./ui.jsx";

export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function can(admin, perm) {
  return Boolean(admin?.permissions?.includes(perm));
}

export function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post("/auth/login", { email, password, totp: totp || undefined });
      onLogin(r.admin);
    } catch (err) {
      if (err instanceof ApiError && err.code === "totp_required") setNeedTotp(true);
      else setError(new Error({ invalid_credentials: "Wrong email or password.", invalid_totp: "Wrong 2FA code.", locked: "Too many attempts. Try again in 15 minutes.", rate_limited: "Too many attempts. Wait a few minutes." }[err.code] || err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1 style={{ marginBottom: 4 }}>KK<span style={{ color: "var(--accent)" }}>MDM</span></h1>
        <p className="muted" style={{ marginTop: 0 }}>KnotKitchen tablet management</p>
        <Field label="Email"><input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {needTotp && (
          <Field label="2FA code"><input autoFocus inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} /></Field>
        )}
        <Err error={error} />
        <button className="btn primary" disabled={busy} style={{ width: "100%" }}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}

/**
 * Asks for the password (and 2FA) again before a destructive action, then
 * retries it. Usage: const reauth = useReauth(); reauth.guard(() => api.post(...))
 */
export function useReauth() {
  const [pending, setPending] = useState(null);
  const guard = async (fn) => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 428) {
        return new Promise((resolve, reject) => setPending({ fn, resolve, reject }));
      }
      throw e;
    }
  };
  const dialog = pending ? <ReauthDialog pending={pending} onDone={() => setPending(null)} /> : null;
  return { guard, dialog };
}

function ReauthDialog({ pending, onDone }) {
  const { admin } = useAuth();
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/auth/reauth", { password, totp: totp || undefined });
      const r = await pending.fn();
      pending.resolve(r);
      onDone();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Modal title="Confirm it's you" onClose={() => { pending.reject(new Error("cancelled")); onDone(); }}>
      <form onSubmit={submit}>
        <p className="muted">This action is destructive. Enter your password{admin?.totpEnabled ? " and 2FA code" : ""} to continue.</p>
        <Field label="Password"><input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {admin?.totpEnabled && <Field label="2FA code"><input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} /></Field>}
        <Err error={error} />
        <button className="btn primary">Confirm</button>
      </form>
    </Modal>
  );
}
