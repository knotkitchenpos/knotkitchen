import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiCheckCircle, FiAlertCircle, FiCopy, FiArrowRight } from "react-icons/fi";
import { onboarding, errorMessage, fieldErrors } from "../api";

const EMPTY = {
  restaurantName: "", addressLine1: "", addressLine2: "", city: "", state: "",
  postalCode: "", restaurantPhone: "", mapsLink: "", restaurantType: "",
  ownerName: "", ownerPhone: "", ownerEmail: "",
  gstRegistered: false, gstin: "", fssaiNumber: "", fssaiValidUntil: "",
};

const Field = ({ label, name, value, onChange, error, required, hint, ...rest }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
      {label} {required && <span className="text-brand-600">*</span>}
    </span>
    <input
      name={name}
      value={value}
      onChange={onChange}
      aria-invalid={!!error}
      className={`w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-navy-900 outline-none ${
        error ? "border-red-400 focus:border-red-500" : "border-navy-200 focus:border-brand-500"
      }`}
      {...rest}
    />
    {error ? (
      <span className="mt-1 block text-xs text-red-600">{error}</span>
    ) : (
      hint && <span className="mt-1 block text-xs text-navy-400">{hint}</span>
    )}
  </label>
);

const Section = ({ title, children }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
    <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    <div className="grid gap-4 sm:grid-cols-2">{children}</div>
  </section>
);

const Onboarding = () => {
  const [form, setForm] = useState(EMPTY);
  const [types, setTypes] = useState([]);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    onboarding.options().then((d) => setTypes(d.restaurantTypes)).catch(() => setTypes([]));
  }, []);

  const set = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
    setErrors((x) => ({ ...x, [name]: undefined }));
    setBanner("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      setCreated(await onboarding.createStore(form));
      setForm(EMPTY);
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setBanner(
        Object.keys(fe).length
          ? "Please correct the highlighted fields."
          : errorMessage(err, "Could not create the store.")
      );
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 text-center">
          <FiCheckCircle className="mx-auto text-emerald-600" size={40} aria-hidden="true" />
          <h1 className="mt-3 text-xl font-bold text-navy-900">{created.restaurantName} onboarded</h1>
          <p className="mt-1 text-sm text-navy-600">Share this Store ID with the restaurant to sign in.</p>

          <div className="mt-5 flex items-center justify-center gap-3">
            <span className="rounded-xl bg-white px-5 py-3 font-mono text-3xl font-bold tracking-widest text-navy-900">
              {created.storeId}
            </span>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(created.storeId);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-xl border border-navy-300 bg-white p-3 text-navy-600 hover:text-navy-900"
              aria-label="Copy Store ID"
            >
              <FiCopy />
            </button>
          </div>
          {copied && <p className="mt-2 text-xs text-emerald-700">Copied.</p>}

          {created.storefrontError && (
            <p className="mx-auto mt-4 max-w-md rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-800">
              The store was created, but its public website could not be provisioned
              ({created.storefrontError}). The store works normally; provisioning can be retried.
            </p>
          )}

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              to={`/stores/${created.storeId}`}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
            >
              View store <FiArrowRight aria-hidden="true" />
            </Link>
            <button
              type="button"
              onClick={() => setCreated(null)}
              className="rounded-xl border border-navy-300 bg-white px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50"
            >
              Onboard another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-navy-900">Store Onboarding</h1>
        <p className="mt-1 text-sm text-navy-500">
          Register a new restaurant. A unique 6-digit Store ID is generated automatically.
        </p>
      </header>

      {banner && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700"
        >
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{banner}</span>
        </div>
      )}

      <form onSubmit={submit} className="space-y-5" noValidate>
        <Section title="Restaurant information">
          <div className="sm:col-span-2">
            <Field label="Restaurant display name" name="restaurantName" required
              value={form.restaurantName} onChange={set} error={errors.restaurantName} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Address line 1" name="addressLine1" required
              value={form.addressLine1} onChange={set} error={errors.addressLine1} />
          </div>
          <div className="sm:col-span-2">
            <Field label="Address line 2" name="addressLine2"
              value={form.addressLine2} onChange={set} error={errors.addressLine2} />
          </div>
          <Field label="City" name="city" required value={form.city} onChange={set} error={errors.city} />
          <Field label="State" name="state" required value={form.state} onChange={set} error={errors.state} />
          <Field label="PIN code" name="postalCode" required inputMode="numeric" maxLength={6}
            value={form.postalCode} onChange={set} error={errors.postalCode} />
          <Field label="Restaurant phone" name="restaurantPhone" inputMode="numeric" maxLength={10}
            value={form.restaurantPhone} onChange={set} error={errors.restaurantPhone}
            hint="The restaurant's public line" />
          <div className="sm:col-span-2">
            <Field label="Google Maps link" name="mapsLink" value={form.mapsLink}
              onChange={set} error={errors.mapsLink} placeholder="https://maps.google.com/…" />
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Restaurant type
            </span>
            <select
              name="restaurantType"
              value={form.restaurantType}
              onChange={set}
              className="w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-900 outline-none focus:border-brand-500"
            >
              <option value="">Select…</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {errors.restaurantType && (
              <span className="mt-1 block text-xs text-red-600">{errors.restaurantType}</span>
            )}
          </label>
        </Section>

        <Section title="Owner information">
          <Field label="Owner name" name="ownerName" required
            value={form.ownerName} onChange={set} error={errors.ownerName} />
          <Field label="Owner phone" name="ownerPhone" required inputMode="numeric" maxLength={10}
            value={form.ownerPhone} onChange={set} error={errors.ownerPhone}
            hint="Used by the owner to sign in to the POS" />
          <div className="sm:col-span-2">
            <Field label="Owner email" name="ownerEmail" type="email"
              value={form.ownerEmail} onChange={set} error={errors.ownerEmail} />
          </div>
        </Section>

        <Section title="Compliance">
          <label className="flex items-center gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              name="gstRegistered"
              checked={form.gstRegistered}
              onChange={set}
              className="h-4 w-4 rounded border-navy-300 text-brand-600"
            />
            <span className="text-sm font-medium text-navy-800">This business is GST registered</span>
          </label>

          {form.gstRegistered && (
            <div className="sm:col-span-2">
              <Field label="GSTIN" name="gstin" required value={form.gstin} onChange={set}
                error={errors.gstin} maxLength={15} style={{ textTransform: "uppercase" }}
                placeholder="22AAAAA0000A1Z5" />
            </div>
          )}

          <Field label="FSSAI licence number" name="fssaiNumber" inputMode="numeric" maxLength={14}
            value={form.fssaiNumber} onChange={set} error={errors.fssaiNumber} hint="14 digits" />
          <Field label="FSSAI valid until" name="fssaiValidUntil" type="date"
            value={form.fssaiValidUntil} onChange={set} error={errors.fssaiValidUntil} />
        </Section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-brand-600 px-6 py-3 font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? "Creating store…" : "Create store"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default Onboarding;
