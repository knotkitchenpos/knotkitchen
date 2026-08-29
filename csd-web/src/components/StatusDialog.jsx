import React, { useEffect, useState } from "react";
import { FiX, FiAlertTriangle } from "react-icons/fi";
import { stores, errorMessage } from "../api";

const OPTIONS = [
  { value: "active", label: "Active", help: "Trading normally; the storefront serves customers." },
  { value: "pending", label: "Pending", help: "Not yet verified. The storefront is unavailable." },
  { value: "suspended", label: "Suspended", help: "Disabled by KnotKitchen. The storefront is unavailable." },
  { value: "closed_temporarily", label: "Closed temporarily", help: "A short trading pause." },
  { value: "closed_until", label: "Closed until a date", help: "Reopens automatically on the date given." },
];

/** Statuses that stop the public storefront serving customers. */
const DISRUPTIVE = new Set(["pending", "suspended", "closed_temporarily", "closed_until"]);

/** Today in YYYY-MM-DD, for the date input's min. */
const todayIso = () => new Date().toISOString().slice(0, 10);

const StatusDialog = ({ store, onClose, onSaved }) => {
  const [status, setStatus] = useState(store.status);
  const [reason, setReason] = useState("");
  const [closedUntil, setClosedUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await stores.updateStatus(store.storeId, {
        status,
        reason,
        closedUntil: status === "closed_until" ? closedUntil : undefined,
      });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err, "Could not update the status."));
    } finally {
      setBusy(false);
    }
  };

  const chosen = OPTIONS.find((o) => o.value === status);
  const changed = status !== store.status;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Change store status"
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Change store status</h2>
            <p className="text-sm text-navy-500">
              {store.restaurantName} · <span className="font-mono">{store.storeId}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            {OPTIONS.map((o) => (
              <label key={o.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
                  status === o.value ? "border-brand-500 bg-brand-50" : "border-navy-200 hover:bg-navy-50"
                }`}>
                <input type="radio" name="status" value={o.value} checked={status === o.value}
                  onChange={(e) => setStatus(e.target.value)} className="mt-1 text-brand-600" />
                <span>
                  <span className="block text-sm font-semibold text-navy-900">{o.label}</span>
                  <span className="block text-xs text-navy-500">{o.help}</span>
                </span>
              </label>
            ))}
          </div>

          {status === "closed_until" && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Reopens on <span className="text-brand-600">*</span>
              </span>
              <input type="date" value={closedUntil} min={todayIso()} required
                onChange={(e) => setClosedUntil(e.target.value)}
                className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
            </label>
          )}

          {status !== "active" && (
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Reason
              </span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
                placeholder="Recorded in the audit log"
                className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
            </label>
          )}

          {changed && DISRUPTIVE.has(status) && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Customers will no longer be able to order from this restaurant's website
                while it is <strong>{chosen.label.toLowerCase()}</strong>.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button type="submit" disabled={busy || !changed}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "Saving…" : "Save status"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StatusDialog;
