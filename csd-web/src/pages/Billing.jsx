import React, { useEffect, useMemo, useState } from "react";
import { FiPlus, FiTrash2, FiAlertTriangle, FiCheckCircle } from "react-icons/fi";
import { billingConfig, errorMessage } from "../api";

/**
 * KnotKitchen's own pricing — the only place it can be set.
 *
 * Everything a restaurant is ever charged originates on this screen: plan
 * prices, promotional windows, GST, the per-order website charge, and the
 * renewal and lock policies. No restaurant-facing screen can change any of it.
 *
 * Money is typed and shown in RUPEES. The server converts to paise and is the
 * only converter; doing arithmetic on money here would be a second place for
 * a hundredfold error to appear.
 */

const Card = ({ title, subtitle, children, warn }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
    <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-navy-500">{subtitle}</p>}
    {warn && (
      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <FiAlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{warn}</span>
      </p>
    )}
    <div className="mt-4 space-y-4">{children}</div>
  </section>
);

const Field = ({ label, hint, error, children, className = "" }) => (
  <label className={`block ${className}`}>
    <span className="text-xs font-semibold text-navy-700">{label}</span>
    {children}
    {error ? (
      <span className="mt-1 block text-xs font-medium text-red-600">{error}</span>
    ) : (
      hint && <span className="mt-1 block text-xs text-navy-500">{hint}</span>
    )}
  </label>
);

const input =
  "mt-1 w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-900 " +
  "focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500 disabled:bg-navy-50";

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3">
    <input
      type="checkbox"
      checked={Boolean(checked)}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 accent-navy-700"
    />
    <span>
      <span className="text-sm font-medium text-navy-800">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-navy-500">{hint}</span>}
    </span>
  </label>
);

/** yyyy-mm-dd for a date input, or "" — an invalid value silently blanks the field. */
const asInputDate = (v) => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const ORDER_SOURCES = ["WEBSITE", "QR", "MARKETPLACE", "PHONE", "POS"];

const Billing = () => {
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    billingConfig
      .get()
      .then((d) => {
        if (!alive) return;
        setConfig(d);
        setSaved(JSON.stringify(d));
      })
      .catch((err) => alive && setLoadError(errorMessage(err, "Could not load billing settings.")));
    return () => {
      alive = false;
    };
  }, []);

  const dirty = useMemo(
    () => Boolean(config) && JSON.stringify(config) !== saved,
    [config, saved],
  );

  const set = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const setPlan = (i, patch) =>
    setConfig((c) => ({
      ...c,
      plans: c.plans.map((p, j) => (j === i ? { ...p, ...patch } : p)),
    }));
  const setOffer = (i, patch) =>
    setPlan(i, { offer: { ...config.plans[i].offer, ...patch } });

  const addPlan = () =>
    set({
      plans: [
        ...config.plans,
        {
          code: "",
          name: "",
          price: 0,
          isActive: true,
          isAvailable: true,
          sortOrder: config.plans.length,
          features: [],
          offer: { price: null, startsAt: null, endsAt: null, label: "" },
        },
      ],
    });

  const save = async () => {
    setSaving(true);
    setSaveError("");
    setFieldErrors({});
    try {
      const fresh = await billingConfig.save(config);
      setConfig(fresh);
      setSaved(JSON.stringify(fresh));
      setSavedAt(new Date());
    } catch (err) {
      setFieldErrors(err?.response?.data?.fieldErrors || {});
      setSaveError(errorMessage(err, "Could not save. Nothing was changed."));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
  if (!config) return <p className="text-sm text-navy-500">Loading billing settings…</p>;

  const gstLive = config.gst.registered && config.gst.effectiveFrom;

  return (
    <div className="space-y-5 pb-24">
      <header>
        <h1 className="text-xl font-bold text-navy-900">Billing</h1>
        <p className="mt-0.5 text-sm text-navy-500">
          KnotKitchen&rsquo;s own pricing. Restaurants can see what they pay but never change it.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Plans"
        subtitle="Prices in rupees, before GST. A plan that is retired keeps its existing subscribers."
      >
        {config.plans.length === 0 && (
          <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-600">
            No plans yet. Until at least one exists, nothing can be subscribed to.
          </p>
        )}

        {config.plans.map((plan, i) => (
          <div key={i} className="rounded-xl border border-navy-200 p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Code" hint="Used internally; cannot repeat." error={fieldErrors[`plans.${i}.code`]}>
                <input
                  className={input}
                  value={plan.code}
                  onChange={(e) => setPlan(i, { code: e.target.value })}
                  placeholder="growth"
                />
              </Field>
              <Field label="Name" error={fieldErrors[`plans.${i}.name`]}>
                <input
                  className={input}
                  value={plan.name}
                  onChange={(e) => setPlan(i, { name: e.target.value })}
                  placeholder="Growth"
                />
              </Field>
              <Field label="Price (₹)" error={fieldErrors[`plans.${i}.price`]}>
                <input
                  className={input}
                  type="number"
                  min="0"
                  step="1"
                  value={plan.price}
                  onChange={(e) => setPlan(i, { price: e.target.value })}
                />
              </Field>
              <Field label="Order" hint="Display order">
                <input
                  className={input}
                  type="number"
                  value={plan.sortOrder}
                  onChange={(e) => setPlan(i, { sortOrder: e.target.value })}
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <Field label="Offer price (₹)" hint="Blank = no offer" error={fieldErrors[`plans.${i}.offer.price`]}>
                <input
                  className={input}
                  type="number"
                  min="0"
                  value={plan.offer?.price ?? ""}
                  onChange={(e) =>
                    setOffer(i, { price: e.target.value === "" ? null : e.target.value })
                  }
                />
              </Field>
              <Field label="Offer starts" error={fieldErrors[`plans.${i}.offer.startsAt`]}>
                <input
                  className={input}
                  type="date"
                  value={asInputDate(plan.offer?.startsAt)}
                  onChange={(e) => setOffer(i, { startsAt: e.target.value || null })}
                />
              </Field>
              <Field label="Offer ends" error={fieldErrors[`plans.${i}.offer.endsAt`]}>
                <input
                  className={input}
                  type="date"
                  value={asInputDate(plan.offer?.endsAt)}
                  onChange={(e) => setOffer(i, { endsAt: e.target.value || null })}
                />
              </Field>
              <div className="flex flex-col justify-center gap-2 pt-4">
                <Toggle
                  checked={plan.isActive}
                  onChange={(v) => setPlan(i, { isActive: v })}
                  label="Active"
                />
                <Toggle
                  checked={plan.isAvailable}
                  onChange={(v) => setPlan(i, { isAvailable: v })}
                  label="Open to new sign-ups"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-navy-500">
                A negotiated price for one restaurant is set on that restaurant&rsquo;s page, not here.
              </p>
              <button
                type="button"
                onClick={() => set({ plans: config.plans.filter((_, j) => j !== i) })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                <FiTrash2 size={13} aria-hidden="true" /> Remove
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addPlan}
          className="inline-flex items-center gap-1.5 rounded-lg border border-navy-300 px-3 py-2 text-xs font-semibold text-navy-700 hover:bg-navy-50"
        >
          <FiPlus size={14} aria-hidden="true" /> Add plan
        </button>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="GST"
        subtitle="Nothing is taxed before the effective date, even with Registered switched on."
        warn={
          config.gst.registered && !config.gst.effectiveFrom
            ? "Registered is on but no start date is set, so nothing would be taxed. Set a date or switch Registered off."
            : null
        }
      >
        <Toggle
          checked={config.gst.registered}
          onChange={(v) => set({ gst: { ...config.gst, registered: v } })}
          label="GST registered"
          hint={gstLive ? "Invoices carry GST from the date below." : "Invoices show the base price only."}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="GSTIN" error={fieldErrors["gst.gstin"]}>
            <input
              className={input}
              value={config.gst.gstin}
              onChange={(e) => set({ gst: { ...config.gst, gstin: e.target.value } })}
              placeholder="19AAAAA0000A1Z5"
            />
          </Field>
          <Field label="Applies from" error={fieldErrors["gst.effectiveFrom"]}>
            <input
              className={input}
              type="date"
              value={asInputDate(config.gst.effectiveFrom)}
              onChange={(e) => set({ gst: { ...config.gst, effectiveFrom: e.target.value || null } })}
            />
          </Field>
          <Field label="Rate (%)" error={fieldErrors["gst.percent"]}>
            <input
              className={input}
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={config.gst.percent}
              onChange={(e) => set({ gst: { ...config.gst, percent: e.target.value } })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Tax mode" hint="Exclusive adds it on top; inclusive means the price already contains it.">
            <select
              className={input}
              value={config.gst.mode}
              onChange={(e) => set({ gst: { ...config.gst, mode: e.target.value } })}
            >
              <option value="exclusive">Exclusive (added on top)</option>
              <option value="inclusive">Inclusive (already in the price)</option>
            </select>
          </Field>
          <Field label="Place of supply" hint="Same state as the restaurant → CGST + SGST; different → IGST.">
            <input
              className={input}
              value={config.gst.placeOfSupplyState}
              onChange={(e) => set({ gst: { ...config.gst, placeOfSupplyState: e.target.value } })}
              placeholder="West Bengal"
            />
          </Field>
          <Field label="Legal name on invoices">
            <input
              className={input}
              value={config.gst.legalName}
              onChange={(e) => set({ gst: { ...config.gst, legalName: e.target.value } })}
              placeholder="KnotKitchen"
            />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Per-order website charge"
        subtitle="Deducted from a restaurant's Business Balance when a qualifying order is paid."
        warn={
          config.websiteOrderCharge.enabled && config.websiteOrderCharge.chargeableSources.length === 0
            ? "The charge is on but no order source is selected, so nothing will be charged."
            : null
        }
      >
        <Toggle
          checked={config.websiteOrderCharge.enabled}
          onChange={(v) =>
            set({ websiteOrderCharge: { ...config.websiteOrderCharge, enabled: v } })
          }
          label="Charge per paid order"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (₹)" error={fieldErrors["websiteOrderCharge.amount"]}>
            <input
              className={input}
              type="number"
              min="0"
              step="0.01"
              value={config.websiteOrderCharge.amount}
              onChange={(e) =>
                set({ websiteOrderCharge: { ...config.websiteOrderCharge, amount: e.target.value } })
              }
            />
          </Field>
          <Field label="Applies from" error={fieldErrors["websiteOrderCharge.effectiveFrom"]}>
            <input
              className={input}
              type="date"
              value={asInputDate(config.websiteOrderCharge.effectiveFrom)}
              onChange={(e) =>
                set({
                  websiteOrderCharge: {
                    ...config.websiteOrderCharge,
                    effectiveFrom: e.target.value || null,
                  },
                })
              }
            />
          </Field>
          <Field label="GST on this charge">
            <select
              className={input}
              value={config.websiteOrderCharge.taxable ? "yes" : "no"}
              onChange={(e) =>
                set({
                  websiteOrderCharge: {
                    ...config.websiteOrderCharge,
                    taxable: e.target.value === "yes",
                  },
                })
              }
            >
              <option value="yes">Taxable</option>
              <option value="no">Not taxable</option>
            </select>
          </Field>
        </div>

        <div>
          <span className="text-xs font-semibold text-navy-700">Chargeable order sources</span>
          <p className="mt-0.5 text-xs text-navy-500">
            Nothing is charged unless its source is ticked. Cancelled, refunded and unpaid orders are
            never charged whatever is selected.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ORDER_SOURCES.map((source) => {
              const on = config.websiteOrderCharge.chargeableSources.includes(source);
              return (
                <button
                  key={source}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      websiteOrderCharge: {
                        ...config.websiteOrderCharge,
                        chargeableSources: on
                          ? config.websiteOrderCharge.chargeableSources.filter((s) => s !== source)
                          : [...config.websiteOrderCharge.chargeableSources, source],
                      },
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    on
                      ? "border-navy-700 bg-navy-700 text-white"
                      : "border-navy-200 text-navy-600 hover:bg-navy-50"
                  }`}
                >
                  {source}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card title="Billing rules" subtitle="How periods, late payment and upgrades behave.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Subscription length (days)" error={fieldErrors.subscriptionDays}>
            <input
              className={input}
              type="number"
              min="1"
              value={config.subscriptionDays}
              onChange={(e) => set({ subscriptionDays: e.target.value })}
            />
          </Field>
          <Field
            label="Grace period (hours)"
            hint="How long an overdue account keeps working before it locks."
            error={fieldErrors.graceHours}
          >
            <input
              className={input}
              type="number"
              min="0"
              value={config.graceHours}
              onChange={(e) => set({ graceHours: e.target.value })}
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Late renewal" hint="Missed days are never free under either option.">
            <select
              className={input}
              value={config.renewalPolicy}
              onChange={(e) => set({ renewalPolicy: e.target.value })}
            >
              <option value="FROM_PAYMENT">New period starts on the payment date</option>
              <option value="FROM_EXPIRY">New period starts at the old expiry</option>
            </select>
          </Field>
          <Field label="Mid-period upgrade">
            <select
              className={input}
              value={config.upgradePolicy}
              onChange={(e) => set({ upgradePolicy: e.target.value })}
            >
              <option value="PRORATE">Difference, for the days remaining</option>
              <option value="FULL_DIFFERENCE">Full difference</option>
              <option value="FULL_PRICE">Full price of the new plan</option>
            </select>
          </Field>
          <Field
            label="What a lock blocks"
            hint="Billing and sign-in always stay open, so an account can always pay its way out."
          >
            <select
              className={input}
              value={config.lockScope}
              onChange={(e) => set({ lockScope: e.target.value })}
            >
              <option value="STAFF">The POS only</option>
              <option value="STAFF_AND_STOREFRONT">The POS and the customer website</option>
            </select>
          </Field>
        </div>
        {config.lockScope === "STAFF_AND_STOREFRONT" && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <FiAlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              This stops the restaurant&rsquo;s own customers ordering and paying, including anyone
              mid-meal trying to settle a table bill.
            </span>
          </p>
        )}
      </Card>

      {/* Save bar — fixed, because this page is long and the button matters. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-navy-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div className="min-w-0 text-xs">
            {saveError ? (
              <span className="font-medium text-red-600">{saveError}</span>
            ) : savedAt && !dirty ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <FiCheckCircle size={13} aria-hidden="true" /> Saved
              </span>
            ) : dirty ? (
              <span className="text-navy-600">Unsaved changes. Nothing applies until you save.</span>
            ) : (
              <span className="text-navy-400">No changes.</span>
            )}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-lg bg-navy-800 px-5 py-2 text-sm font-semibold text-white hover:bg-navy-900 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Billing;
