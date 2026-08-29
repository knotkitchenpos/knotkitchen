import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FiX, FiCheckCircle, FiAlertTriangle, FiMapPin, FiArrowRight, FiCopy, FiCheck,
} from "react-icons/fi";
import { agreements as api, errorMessage, fieldErrors } from "../api";

/**
 * The agreement → store flow.
 *
 * Three steps rather than one button, deliberately:
 *   1. confirm  — the popup the spec describes
 *   2. review   — what will actually be created, plus any mapping warnings.
 *                 The admin is about to create a paying customer record from
 *                 data entered by someone else in another system; showing the
 *                 mapped values is what makes that a decision rather than a leap.
 *   3. created  — the generated Store ID
 */
const Row = ({ label, children, warn }) => (
  <div className="flex justify-between gap-4 border-b border-navy-100 py-2 last:border-b-0">
    <dt className="shrink-0 text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
    <dd className={`text-right text-sm ${warn ? "text-amber-700" : "text-navy-900"}`}>
      {children || <span className="text-navy-400">Not provided</span>}
    </dd>
  </div>
);

const AgreementStoreDialog = ({ agreement, onClose, onCreated }) => {
  const [step, setStep] = useState("confirm");
  const [detail, setDetail] = useState(null);
  const [coords, setCoords] = useState({ latitude: "", longitude: "" });
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (step !== "review" || detail) return;
    api.get(agreement.id)
      .then(setDetail)
      .catch((err) => setBanner(errorMessage(err, "Could not load the agreement.")));
  }, [step, detail, agreement.id]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      setResult(await api.createStore(agreement.id, coords));
      setStep("created");
      onCreated?.();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setBanner(Object.keys(fe).length ? "Please correct the highlighted fields." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const m = detail?.mapped;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Create store from agreement"
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">

        {/* ── Step 1: the confirmation popup ─────────────────────────── */}
        {step === "confirm" && (
          <>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <FiCheckCircle className="mt-0.5 shrink-0 text-emerald-600" size={22} aria-hidden="true" />
                <h2 className="text-lg font-bold text-navy-900">Agreement successfully completed</h2>
              </div>
              <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <FiX size={20} />
              </button>
            </div>

            <p className="text-sm text-navy-700">
              The agreement for <strong>{agreement.restaurantName || "this restaurant"}</strong> has been
              successfully completed
              {agreement.salesAgent ? <> by <strong>{agreement.salesAgent}</strong></> : null}.
            </p>
            <p className="mt-3 text-sm text-navy-700">Do you want to create a store for this restaurant?</p>
            <p className="mt-2 text-xs text-navy-400">
              Agreement <span className="font-mono">{agreement.id}</span>
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={onClose}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Cancel
              </button>
              <button type="button" onClick={() => setStep("review")}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
                Yes, create store <FiArrowRight aria-hidden="true" />
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: review + coordinates ───────────────────────────── */}
        {step === "review" && (
          <>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-navy-900">Create store</h2>
                <p className="text-xs text-navy-500">
                  From agreement <span className="font-mono">{agreement.id}</span>
                </p>
              </div>
              <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
                <FiX size={20} />
              </button>
            </div>

            {banner && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{banner}</p>}
            {!detail && !banner && <p className="text-sm text-navy-500">Loading the agreement…</p>}

            {detail && (
              <form onSubmit={submit} className="space-y-4">
                {detail.missing?.length > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                    <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>
                      This agreement is missing information a store needs:{" "}
                      <strong>{detail.missing.join(", ")}</strong>. It must be corrected in the
                      onboarding portal before a store can be created.
                    </span>
                  </div>
                )}

                {detail.warnings?.length > 0 && (
                  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="mb-1 font-semibold">Worth checking before you continue:</p>
                    <ul className="list-inside list-disc space-y-0.5">
                      {detail.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <section className="rounded-xl border border-navy-200 p-3.5">
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-navy-600">
                    Will be created as
                  </h3>
                  <dl>
                    <Row label="Restaurant">{m.restaurantName}</Row>
                    <Row label="Type">{m.restaurantType}</Row>
                    <Row label="Address">
                      {[m.addressLine1, m.city, m.state, m.postalCode].filter(Boolean).join(", ")}
                    </Row>
                    <Row label="Restaurant phone">{m.restaurantPhone && `+91 ${m.restaurantPhone}`}</Row>
                    <Row label="Owner">{m.ownerName}</Row>
                    <Row label="Owner phone">{m.ownerPhone && `+91 ${m.ownerPhone}`}</Row>
                    <Row label="Owner email">{m.ownerEmail}</Row>
                    <Row label="GST">{m.gstRegistered ? m.gstin || "Registered" : "Not registered"}</Row>
                    <Row label="FSSAI">{m.fssaiNumber}</Row>
                    <Row label="FSSAI valid until">{m.fssaiValidUntil}</Row>
                    <Row label="Sales agent">{m.salesAgentName}</Row>
                  </dl>
                  <p className="mt-2 text-xs text-navy-400">
                    A unique 6-digit Store ID is generated automatically.
                  </p>
                </section>

                <section className="rounded-xl border border-brand-300 bg-brand-50 p-3.5">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-navy-700">
                    <FiMapPin size={12} aria-hidden="true" /> Restaurant coordinates
                  </h3>
                  <p className="mb-3 text-xs text-navy-600">
                    The only thing the agreement doesn't carry — used to place the restaurant for
                    delivery and search.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { name: "latitude", label: "Latitude", ph: "22.5726" },
                      { name: "longitude", label: "Longitude", ph: "88.3639" },
                    ].map((f) => (
                      <label key={f.name} className="block">
                        <span className="mb-1 block text-xs font-semibold text-navy-600">{f.label}</span>
                        <input
                          value={coords[f.name]}
                          onChange={(e) => {
                            setCoords((c) => ({ ...c, [f.name]: e.target.value }));
                            setErrors((x) => ({ ...x, [f.name]: undefined }));
                          }}
                          inputMode="decimal" placeholder={f.ph} required
                          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none ${
                            errors[f.name] ? "border-red-400" : "border-navy-200 focus:border-brand-500"
                          }`}
                        />
                        {errors[f.name] && (
                          <span className="mt-1 block text-xs text-red-600">{errors[f.name]}</span>
                        )}
                      </label>
                    ))}
                  </div>
                </section>

                <div className="flex justify-end gap-3">
                  <button type="button" onClick={onClose} disabled={busy}
                    className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy || detail.missing?.length > 0}
                    className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                    {busy ? "Creating store…" : "Save & activate store"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}

        {/* ── Step 3: created ────────────────────────────────────────── */}
        {step === "created" && result && (
          <div className="text-center">
            <FiCheckCircle className="mx-auto text-emerald-600" size={40} aria-hidden="true" />
            <h2 className="mt-3 text-xl font-bold text-navy-900">{result.restaurantName} created</h2>
            <p className="mt-1 text-sm text-navy-600">Share this Store ID with the restaurant.</p>

            <div className="mt-5 flex items-center justify-center gap-3">
              <span className="rounded-xl bg-navy-50 px-5 py-3 font-mono text-3xl font-bold tracking-widest text-navy-900">
                {result.storeId}
              </span>
              <button type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(result.storeId);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-xl border border-navy-300 p-3 text-navy-600 hover:text-navy-900"
                aria-label="Copy Store ID">
                {copied ? <FiCheck className="text-emerald-600" /> : <FiCopy />}
              </button>
            </div>

            {/* Surface partial failures rather than implying everything worked. */}
            {!result.portalNotified && (
              <p className="mx-auto mt-4 max-w-sm rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-800">
                The store exists, but the onboarding portal could not be told
                {result.portalNotifyError ? ` (${result.portalNotifyError})` : ""}. The agreement may
                still show as awaiting a store there — it can be retried from the agreements list.
              </p>
            )}
            {result.storefrontError && (
              <p className="mx-auto mt-3 max-w-sm rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-800">
                The store works, but its public website could not be provisioned
                ({result.storefrontError}).
              </p>
            )}

            <div className="mt-6 flex justify-center gap-3">
              <button type="button" onClick={onClose}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Done
              </button>
              <Link to={`/stores/${result.storeId}`}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
                View store <FiArrowRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgreementStoreDialog;
