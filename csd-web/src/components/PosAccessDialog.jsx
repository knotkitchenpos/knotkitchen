import React, { useState } from "react";
import { FiX, FiAlertTriangle, FiExternalLink, FiCopy, FiCheck } from "react-icons/fi";
import { restaurants as api, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * §22 — opens a POS support session for one restaurant.
 *
 * Deliberately a two-step flow rather than a plain link. Entering a customer's
 * live POS is consequential, so the operator states a reason first, is told
 * plainly that the access is recorded, and only then gets a link. That reason
 * is what makes the audit trail useful months later.
 */
const PosAccessDialog = ({ storeId, restaurantName, onClose }) => {
  const { staff } = useAuth();
  const [reason, setReason] = useState("");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const open = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setSession(await api.openPos(storeId, reason.trim()));
    } catch (err) {
      setError(errorMessage(err, "Could not open a POS session."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="POS support access"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-navy-900">POS support access</h2>
            <p className="text-sm text-navy-500">
              {restaurantName} · <span className="font-mono">{storeId}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {!session ? (
          <form onSubmit={open} className="space-y-4">
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
              <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">You are about to enter a customer's live POS.</p>
                <p className="mt-1 text-xs">
                  You will be able to view and create orders and change their menu. This session is
                  recorded against <strong>{staff?.fullName}</strong> ({staff?.staffId}) and appears
                  in this restaurant's activity log.
                </p>
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Reason for access
              </span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
                placeholder="e.g. Owner called — updating menu prices on their behalf"
                className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
              <span className="mt-1 block text-xs text-navy-400">
                Recorded with the session. Helps whoever reads this log later — including you.
              </span>
            </label>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} disabled={busy}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Cancel
              </button>
              <button type="submit" disabled={busy}
                className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {busy ? "Opening…" : "Open POS session"}
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-sm text-emerald-900">
              Session created. It is valid for {Math.round(session.ttlSeconds / 60)} minutes and can
              be used once.
            </div>

            {/* The per-store POS host needs its own wildcard DNS + certificate;
                until that exists the link would fail, so say so rather than
                sending someone to a dead URL. */}
            {!session.posHostReady && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm text-amber-900">
                <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    <code className="font-mono text-xs">{session.posHost}</code> is not reachable yet.
                  </p>
                  <p className="mt-1 text-xs">
                    Per-store POS hosts need their own wildcard DNS record and certificate — the
                    existing platform wildcard does not cover a two-level subdomain. The token below
                    is valid; the POS must be taught to accept it before this link works.
                  </p>
                </div>
              </div>
            )}

            <div>
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Session token
              </span>
              <div className="flex items-center gap-2 rounded-xl border border-navy-200 bg-navy-50 px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs text-navy-700">{session.token}</code>
                <button type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(session.token);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="shrink-0 text-navy-500 hover:text-navy-800" aria-label="Copy token">
                  {copied ? <FiCheck className="text-emerald-600" /> : <FiCopy />}
                </button>
              </div>
              <p className="mt-1 text-xs text-navy-400">Shown once — it is stored only as a hash.</p>
            </div>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Done
              </button>
              <a href={session.posUrl || undefined} target="_blank" rel="noopener noreferrer"
                aria-disabled={!session.posUrl}
                onClick={(e) => { if (!session.posUrl) e.preventDefault(); }}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white ${
                  session.posUrl ? "bg-brand-600 hover:bg-brand-500" : "cursor-not-allowed bg-navy-300"
                }`}>
                Open POS <FiExternalLink aria-hidden="true" />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PosAccessDialog;
