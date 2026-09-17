import React, { useState } from "react";
import { FiX, FiAlertTriangle } from "react-icons/fi";
import { restaurants as api, errorMessage, fieldErrors } from "../api";
import { inr } from "../lib/format";


/**
 * Module scope, not inside ChargesDialog: a component declared in another
 * component's body is a new type on every render, so React remounts it and
 * the input loses focus after each keystroke.
 */
const Field = ({ label, name, prefix, suffix, hint, form, errors, onChange }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">{label}</span>
    <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 ${
      errors[name] ? "border-red-400" : "border-navy-200 focus-within:border-brand-500"
    }`}>
      {prefix && <span className="shrink-0 text-sm text-navy-500">{prefix}</span>}
      <input name={name} value={form[name]} onChange={onChange} type="number" min="0" step="0.01"
        className="w-full bg-transparent text-sm text-navy-900 outline-none" />
      {suffix && <span className="shrink-0 text-sm text-navy-500">{suffix}</span>}
    </div>
    {errors[name] ? (
      <span className="mt-1 block text-xs text-red-600">{errors[name]}</span>
    ) : hint ? (
      <span className="mt-1 block text-xs text-navy-400">{hint}</span>
    ) : null}
  </label>
);

/** §29 — admin-only. The route is guarded server-side regardless. */
const ChargesDialog = ({ storeId, charges, onClose, onSaved }) => {
  const [form, setForm] = useState({
    onlinePaidOrderCharge: String(charges.onlinePaidOrderCharge ?? ""),
    gstPercent: String(charges.gstPercent ?? ""),
    monthlySubscription: String(charges.monthlySubscription ?? ""),
  });
  const [exempt, setExempt] = useState(Boolean(charges.billingExempt));
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((x) => ({ ...x, [e.target.name]: undefined }));
    setBanner("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      await api.updateCharges(storeId, {
        onlinePaidOrderCharge: Number(form.onlinePaidOrderCharge),
        gstPercent: Number(form.gstPercent),
        monthlySubscription: Number(form.monthlySubscription),
        billingExempt: exempt,
      });
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setBanner(Object.keys(fe).length ? "Please correct the highlighted fields." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const gross = (base) => {
    const n = Number(base);
    const g = Number(form.gstPercent);
    if (Number.isNaN(n) || Number.isNaN(g)) return null;
    return n * (1 + g / 100);
  };

  const fieldProps = { form, errors, onChange: set };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Edit store charges"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Store charges</h2>
            <p className="text-xs text-navy-500">Store <span className="font-mono">{storeId}</span></p>
          </div>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {banner && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{banner}</p>}

        <form onSubmit={submit} className="space-y-4">
          <Field label="Online paid order charge" name="onlinePaidOrderCharge" prefix="₹" suffix="/ order" {...fieldProps} />
          <Field label="GST" name="gstPercent" suffix="%" {...fieldProps} />
          <Field label="Monthly subscription" name="monthlySubscription" prefix="₹" suffix="/ month" {...fieldProps} />

          <label className="flex items-start gap-3 rounded-xl border border-navy-200 p-3">
            <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-navy-900">Demo store — never billed</span>
              <span className="block text-xs text-navy-500">
                No subscription needed, no per-order or e-bill charges, and the POS never locks. For demo and testing stores only.
              </span>
            </span>
          </label>

          {/* Show the number the restaurant actually pays — the spec quotes
              amounts as "+ GST", which is easy to misread when editing. */}
          <div className="rounded-xl bg-navy-50 p-3 text-xs text-navy-600">
            <div className="flex justify-between">
              <span>Per online paid order, incl. GST</span>
              <span className="font-semibold text-navy-900">
                {gross(form.onlinePaidOrderCharge) === null ? "—" : inr(gross(form.onlinePaidOrderCharge))}
              </span>
            </div>
            <div className="mt-1 flex justify-between">
              <span>Monthly subscription, incl. GST</span>
              <span className="font-semibold text-navy-900">
                {gross(form.monthlySubscription) === null ? "—" : inr(gross(form.monthlySubscription))}
              </span>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
            This changes what the restaurant is billed. The change is recorded against your name.
          </p>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button type="submit" disabled={busy}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "Saving…" : "Save charges"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChargesDialog;
