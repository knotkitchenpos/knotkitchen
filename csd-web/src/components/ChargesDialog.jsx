import React, { useEffect, useState } from "react";
import { FiX, FiAlertTriangle, FiPlus, FiTrash2 } from "react-icons/fi";
import { restaurants as api, billingConfig, errorMessage, fieldErrors } from "../api";
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

/**
 * Everything a negotiated price can be for, from the live catalogue: the POS
 * plan, each add-on, the first and each extra tablet, each printer. The codes
 * are the ones services/pricing priceFor matches.
 */
const catalogItems = (c) => [
  { code: c.basePlan.code, label: `${c.basePlan.name} plan / month`, price: c.basePlan.price },
  ...c.addons.map((a) => ({ code: a.code, label: `${a.name} / month`, price: a.price })),
  { code: "TABLET_FIRST", label: "First tablet / month", price: c.tablet.firstPrice },
  { code: "TABLET_EXTRA", label: "Each extra tablet / month", price: c.tablet.extraPrice },
  ...c.printers.map((p) => ({ code: p.code, label: `${p.name} (one-time)`, price: p.price })),
];

const box = "rounded-xl border px-3 py-2 text-sm text-navy-900 outline-none focus:border-brand-500";

/** §29 — admin-only. The route is guarded server-side regardless. */
const ChargesDialog = ({ storeId, charges, onClose, onSaved }) => {
  const [form, setForm] = useState({
    onlinePaidOrderCharge: String(charges.onlinePaidOrderCharge ?? ""),
    gstPercent: String(charges.gstPercent ?? ""),
  });
  const [prices, setPrices] = useState(() =>
    (charges.planPrices || []).map((p) => ({ code: String(p.code).toUpperCase(), price: String(p.price) })),
  );
  const [catalog, setCatalog] = useState(null);
  const [exempt, setExempt] = useState(Boolean(charges.billingExempt));
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    billingConfig.get().then((c) => setCatalog(catalogItems(c))).catch(() => setCatalog([]));
  }, []);

  const set = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((x) => ({ ...x, [e.target.name]: undefined }));
    setBanner("");
  };

  const setPrice = (i, patch) => {
    setPrices((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
    setErrors({});
    setBanner("");
  };

  const submit = async (e) => {
    e.preventDefault();
    // A blank price would reach the server as 0 -- free -- so it is refused here.
    const blank = {};
    prices.forEach((p, i) => {
      if (String(p.price).trim() === "") blank[`planPrices.${i}.price`] = "Enter the price.";
    });
    if (Object.keys(blank).length) {
      setErrors(blank);
      setBanner("Please correct the highlighted fields.");
      return;
    }
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      await api.updateCharges(storeId, {
        onlinePaidOrderCharge: Number(form.onlinePaidOrderCharge),
        gstPercent: Number(form.gstPercent),
        billingExempt: exempt,
        // The whole list, so removing a row puts the store back on the standard price.
        planPrices: prices.map((p) => ({ code: p.code, price: Number(p.price) })),
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
  const taken = new Set(prices.map((p) => p.code));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Edit store charges"
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
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

          <div>
            <span className="block text-xs font-semibold uppercase tracking-wider text-navy-600">Negotiated prices</span>
            <span className="mt-0.5 block text-xs text-navy-400">
              Rupees, before GST. Anything not listed is charged at the standard price.
            </span>
            {errors.planPrices && <span className="mt-1 block text-xs text-red-600">{errors.planPrices}</span>}

            <div className="mt-2 space-y-2">
              {prices.map((p, i) => {
                const item = (catalog || []).find((c) => c.code === p.code);
                const codeErr = errors[`planPrices.${i}.code`];
                const priceErr = errors[`planPrices.${i}.price`];
                return (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <select value={p.code} onChange={(e) => setPrice(i, { code: e.target.value })}
                        aria-label="What the price is for"
                        className={`min-w-0 flex-1 ${box} ${codeErr ? "border-red-400" : "border-navy-200"}`}>
                        <option value="">Choose…</option>
                        {/* A code the catalogue no longer has stays visible so it can be removed. */}
                        {p.code && !item && <option value={p.code}>{p.code} (no longer sold)</option>}
                        {(catalog || []).map((c) => (
                          <option key={c.code} value={c.code} disabled={c.code !== p.code && taken.has(c.code)}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <input value={p.price} onChange={(e) => setPrice(i, { price: e.target.value })}
                        type="number" min="0" step="0.01" aria-label="Price in rupees"
                        className={`w-28 ${box} ${priceErr ? "border-red-400" : "border-navy-200"}`} />
                      <button type="button" aria-label="Remove this price"
                        onClick={() => setPrices((list) => list.filter((_, j) => j !== i))}
                        className="shrink-0 rounded-lg p-2 text-red-600 hover:bg-red-50">
                        <FiTrash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                    {codeErr || priceErr ? (
                      <span className="mt-1 block text-xs text-red-600">{codeErr || priceErr}</span>
                    ) : item ? (
                      <span className="mt-1 block text-xs text-navy-400">Standard price {inr(item.price)} + GST</span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <button type="button" disabled={!catalog}
              onClick={() => setPrices((list) => [...list, { code: "", price: "" }])}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-50">
              <FiPlus size={13} aria-hidden="true" /> {catalog ? "Add a price" : "Loading prices…"}
            </button>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-navy-200 p-3">
            <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand-600" />
            <span>
              <span className="block text-sm font-semibold text-navy-900">Demo store — never billed</span>
              <span className="block text-xs text-navy-500">
                Every add-on without buying it, no per-order or e-bill charges, and the POS never locks. For demo and testing stores only.
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
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
            This changes what the restaurant is billed from its next charge. The change is recorded against your name.
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
