import { createContext, useContext, useState } from "react";
import { ApiError, reauthenticate } from "./api.js";
import { Err, Field, Modal } from "./ui.jsx";

/**
 * The KKMDM account of the signed-in CSD person, and the permission check the
 * KKMDM pages use (as kkmdm/dashboard/src/auth.jsx). There is no KKMDM sign-in
 * screen here: CSD signs in for them (./api.js).
 */
export const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function can(admin, perm) {
  return Boolean(admin?.permissions?.includes(perm));
}

/**
 * Before a destructive action (wiping a tablet and the like) KKMDM asks for a
 * fresh sign-in (HTTP 428). Here that is the person's CSD password and
 * authenticator code, then the action is retried.
 * Usage: const reauth = useReauth(); reauth.guard(() => api.post(...))
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
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await reauthenticate(password, code);
      const r = await pending.fn();
      pending.resolve(r);
      onDone();
    } catch (err) {
      setError(new Error(err?.response?.data?.message || err?.message || "Could not confirm."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Confirm it's you" onClose={() => { pending.reject(new Error("cancelled")); onDone(); }}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>This action cannot be undone. Enter your CSD password and the code from your authenticator app.</p>
        <Field label="CSD password"><input autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Field label="Authenticator code"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
        <Err error={error} />
        <button className="btn primary" disabled={busy || !password || code.length !== 6}>{busy ? "Checking…" : "Confirm"}</button>
      </form>
    </Modal>
  );
}
