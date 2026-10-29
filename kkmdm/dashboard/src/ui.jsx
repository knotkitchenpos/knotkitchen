import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

/** Loads `path` (re-runs when it changes); returns { data, error, loading, reload }. */
export function useApi(path, { interval } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api.get(path);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    load();
    if (!interval) return undefined;
    const t = setInterval(load, interval);
    return () => clearInterval(t);
  }, [load, interval]);
  return { ...state, reload: load };
}

export function ago(d) {
  if (!d) return "never";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function when(d) {
  return d ? new Date(d).toLocaleString("en-IN") : "—";
}

const TONES = {
  online: "ok", locked: "ok", succeeded: "ok", active: "ok", completed: "ok", resolved: "ok", true: "ok",
  offline: "bad", error: "bad", failed: "bad", critical: "bad", revoked: "bad", rolled_back: "bad", false: "bad",
  unlocked: "warn", warning: "warn", expired: "warn", paused: "warn", technician: "warn", lost: "bad", acknowledged: "warn", in_repair: "warn",
  queued: "info", sent: "info", delivered: "info", executing: "info", running: "info", enrolled: "info", open: "bad", used: "",
};

export function Badge({ v, label }) {
  return <span className={`badge ${TONES[String(v)] ?? ""}`}>{label ?? String(v ?? "—")}</span>;
}

export function Err({ error }) {
  if (!error) return null;
  return <div className="err">{error.message || String(error)}</div>;
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="btn small" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Runs an async action with a busy flag and error capture. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

export function Field({ label, children }) {
  return (
    <label className="f">
      {label}
      {children}
    </label>
  );
}

export function Pager({ page, total, limit, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / limit));
  return (
    <div className="row" style={{ marginTop: 10 }}>
      <span className="muted">{total ?? 0} total</span>
      <span className="spacer" />
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
      <span className="muted">{page} / {pages}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}
