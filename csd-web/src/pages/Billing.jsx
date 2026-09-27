import React, { useEffect, useMemo, useState } from "react";
import { FiPlus, FiTrash2, FiAlertTriangle, FiCheckCircle } from "react-icons/fi";
import { billingConfig, errorMessage } from "../api";

/**
 * KnotKitchen's own pricing — the only place it can be set.
 *
 * Everything a restaurant is ever charged originates on this screen: the POS
 * plan, add-ons, tablet rental, printers, the first top-up, GST, the per-order
 * website charge, and the renewal and lock policies. No restaurant-facing
 * screen can change any of it.
 *
 * Money is typed and shown in RUPEES. The server converts to paise and is the
 * only converter; doing arithmetic on money here would be a second place for
 * a hundredfold error to appear.
 */

const Warn = ({ children }) => (
  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
    <FiAlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

const PRICE_NOTICE =
  "Price rises need 30 days' notice to stores before they apply (agreement 2.8). Change the price only after notice has gone out.";

// priceNotice: the card holds prices stores are charged.
const Card = ({ title, subtitle, children, warn, priceNotice }) => (
  <section className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
    <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    {subtitle && <p className="mt-0.5 text-xs text-navy-500">{subtitle}</p>}
    {priceNotice && <Warn>{PRICE_NOTICE}</Warn>}
    {warn && <Warn>{warn}</Warn>}
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

/** A price in rupees, kept as typed. The server converts and validates it. */
const Money = ({ value, onChange }) => (
  <input
    className={input}
    type="number"
    min="0"
    step="1"
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);

const AddButton = ({ label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-lg border border-navy-300 px-3 py-2 text-xs font-semibold text-navy-700 hover:bg-navy-50"
  >
    <FiPlus size={14} aria-hidden="true" /> {label}
  </button>
);

const RemoveButton = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
  >
    <FiTrash2 size={13} aria-hidden="true" /> Remove
  </button>
);

// Only online-gateway orders from these two channels are ever charged: the
// store's own website and table-QR ordering. Values are Order.source.
const ORDER_SOURCES = [
  { value: "WEBSITE", label: "Website" },
  { value: "QR", label: "Table QR" },
];
const SOURCE_VALUES = ORDER_SOURCES.map((o) => o.value);

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
  // One row of the add-on or printer list.
  const setItem = (list, i, patch) =>
    setConfig((c) => ({ ...c, [list]: c[list].map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const addItem = (list, row) => setConfig((c) => ({ ...c, [list]: [...c[list], row] }));
  const removeItem = (list, i) =>
    setConfig((c) => ({ ...c, [list]: c[list].filter((_, j) => j !== i) }));

  // Stores' add-ons, hardware and negotiated prices point at a saved row's
  // code, so a saved row keeps its code and can only be taken off sale, never
  // deleted. New rows are appended, so the saved ones are always the first N.
  const savedCount = useMemo(() => {
    const s = saved ? JSON.parse(saved) : {};
    return { addons: (s.addons || []).length, printers: (s.printers || []).length };
  }, [saved]);

  const save = async () => {
    setSaveError("");
    setFieldErrors({});
    // A charge switched on with no start date would never start; say so here.
    const missing = {};
    if (config.websiteOrderCharge.enabled && !config.websiteOrderCharge.effectiveFrom) {
      missing["websiteOrderCharge.effectiveFrom"] = "Pick the date charging starts.";
    }
    if (config.ebillCharge.enabled && !config.ebillCharge.effectiveFrom) {
      missing["ebillCharge.effectiveFrom"] = "Pick the date charging starts.";
    }
    if (Object.keys(missing).length) {
      setFieldErrors(missing);
      setSaveError("A charge that is switched on needs a start date.");
      return;
    }
    setSaving(true);
    try {
      const fresh = await billingConfig.save({
        ...config,
        // Fixed by policy, no longer settable here: lines are taxed on top
        // (printers aside) and a late renewal starts on the payment day.
        renewalPolicy: "FROM_PAYMENT",
        gst: {
          ...config.gst,
          mode: "exclusive",
          addressLines: (config.gst.addressLines || []).map((l) => l.trim()).filter(Boolean),
        },
        websiteOrderCharge: {
          ...config.websiteOrderCharge,
          chargeableSources: config.websiteOrderCharge.chargeableSources.filter((s) =>
            SOURCE_VALUES.includes(s),
          ),
        },
      });
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
        title="POS plan"
        priceNotice
        subtitle="The base subscription every store pays for each billing period, in rupees, + GST where applicable. Takeaway and delivery only; tables and dine-in come with the QR Table Ordering add-on."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" error={fieldErrors["basePlan.name"]}>
            <input
              className={input}
              value={config.basePlan.name}
              onChange={(e) => set({ basePlan: { ...config.basePlan, name: e.target.value } })}
            />
          </Field>
          <Field
            label="Price (₹)"
            hint={`Every ${config.subscriptionDays} days, from the store's wallet.`}
            error={fieldErrors["basePlan.price"]}
          >
            <Money
              value={config.basePlan.price}
              onChange={(v) => set({ basePlan: { ...config.basePlan, price: v } })}
            />
          </Field>
          <Field
            label="First top-up minimum (₹)"
            hint="A new store's first top-up must be at least this. It starts the POS plan automatically; the rest stays in the wallet."
            error={fieldErrors.firstRechargeMin}
          >
            <Money value={config.firstRechargeMin} onChange={(v) => set({ firstRechargeMin: v })} />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Add-ons"
        priceNotice
        subtitle={`Every ${config.subscriptionDays} days, from the store's wallet, + GST where applicable. Added mid-period, the first charge covers only the days left. Stopped, it runs to the end of the paid period with no refund.`}
      >
        {config.addons.map((a, i) => {
          const isSaved = i < savedCount.addons;
          return (
            <div key={i} className="rounded-xl border border-navy-200 p-4">
              <div className="grid gap-3 sm:grid-cols-4">
                <Field
                  label="Code"
                  hint={isSaved ? "Fixed once saved." : "Capitals, digits or _. Cannot repeat."}
                  error={fieldErrors[`addons.${i}.code`]}
                >
                  <input
                    className={input}
                    value={a.code}
                    disabled={isSaved}
                    onChange={(e) => setItem("addons", i, { code: e.target.value.toUpperCase() })}
                    placeholder="LOYALTY"
                  />
                </Field>
                <Field label="Name" error={fieldErrors[`addons.${i}.name`]}>
                  <input
                    className={input}
                    value={a.name}
                    onChange={(e) => setItem("addons", i, { name: e.target.value })}
                    placeholder="Loyalty programme"
                  />
                </Field>
                <Field label={`Price (₹ / ${config.subscriptionDays} days)`} error={fieldErrors[`addons.${i}.price`]}>
                  <Money value={a.price} onChange={(v) => setItem("addons", i, { price: v })} />
                </Field>
                <Field
                  label="Unlocks"
                  hint="What the POS switches on while it is active."
                  error={fieldErrors[`addons.${i}.feature`]}
                >
                  <select
                    className={input}
                    value={a.feature}
                    onChange={(e) => setItem("addons", i, { feature: e.target.value })}
                  >
                    <option value="">Nothing (a service)</option>
                    <option value="website">Website and online payments</option>
                    <option value="tableQr">QR table ordering, tables and dine-in</option>
                  </select>
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <Field label="Description" className="sm:col-span-3">
                  <input
                    className={input}
                    value={a.description}
                    onChange={(e) => setItem("addons", i, { description: e.target.value })}
                    placeholder="Shown to the restaurant next to the price."
                  />
                </Field>
                <Field label="Order" hint="Display order">
                  <input
                    className={input}
                    type="number"
                    value={a.sortOrder}
                    onChange={(e) => setItem("addons", i, { sortOrder: e.target.value })}
                  />
                </Field>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Toggle
                  checked={a.isActive}
                  onChange={(v) => setItem("addons", i, { isActive: v })}
                  label="On sale"
                  hint="Off: no store can add it any more. Stores that have it keep it until they stop it."
                />
                {!isSaved && <RemoveButton onClick={() => removeItem("addons", i)} />}
              </div>
            </div>
          );
        })}

        <AddButton
          label="Add add-on"
          onClick={() =>
            addItem("addons", {
              code: "",
              name: "",
              description: "",
              price: 0,
              feature: "",
              isActive: true,
              sortOrder: config.addons.length + 1,
            })
          }
        />
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Tablets"
        priceNotice
        subtitle={`A rental every ${config.subscriptionDays} days, + GST where applicable. Before each tablet the store makes one top-up of at least the amount below; that money stays in its wallet and pays its charges.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`First tablet (₹ / ${config.subscriptionDays} days)`} error={fieldErrors["tablet.firstPrice"]}>
            <Money
              value={config.tablet.firstPrice}
              onChange={(v) => set({ tablet: { ...config.tablet, firstPrice: v } })}
            />
          </Field>
          <Field label={`Each extra tablet (₹ / ${config.subscriptionDays} days)`} error={fieldErrors["tablet.extraPrice"]}>
            <Money
              value={config.tablet.extraPrice}
              onChange={(v) => set({ tablet: { ...config.tablet, extraPrice: v } })}
            />
          </Field>
          <Field
            label="Top-up per tablet (₹)"
            hint="The first top-up, which starts the POS plan, never counts."
            error={fieldErrors["tablet.rechargeRequired"]}
          >
            <Money
              value={config.tablet.rechargeRequired}
              onChange={(v) => set({ tablet: { ...config.tablet, rechargeRequired: v } })}
            />
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Printers"
        priceNotice
        subtitle="Price includes GST. Paid once online (UPI, card or netbanking), not from the wallet. No monthly fee."
      >
        {config.printers.map((p, i) => {
          const isSaved = i < savedCount.printers;
          return (
            <div key={i} className="rounded-xl border border-navy-200 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field
                  label="Code"
                  hint={isSaved ? "Fixed once saved." : "Capitals, digits or _. Cannot repeat."}
                  error={fieldErrors[`printers.${i}.code`]}
                >
                  <input
                    className={input}
                    value={p.code}
                    disabled={isSaved}
                    onChange={(e) => setItem("printers", i, { code: e.target.value.toUpperCase() })}
                    placeholder="PRINTER_4IN"
                  />
                </Field>
                <Field label="Name" error={fieldErrors[`printers.${i}.name`]}>
                  <input
                    className={input}
                    value={p.name}
                    onChange={(e) => setItem("printers", i, { name: e.target.value })}
                    placeholder="4-inch receipt printer"
                  />
                </Field>
                <Field label="Price (₹, incl. GST)" error={fieldErrors[`printers.${i}.price`]}>
                  <Money value={p.price} onChange={(v) => setItem("printers", i, { price: v })} />
                </Field>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Toggle
                  checked={p.isActive}
                  onChange={(v) => setItem("printers", i, { isActive: v })}
                  label="On sale"
                />
                {!isSaved && <RemoveButton onClick={() => removeItem("printers", i)} />}
              </div>
            </div>
          );
        })}

        <AddButton
          label="Add printer"
          onClick={() => addItem("printers", { code: "", name: "", price: 0, isActive: true })}
        />
        <p className="text-xs text-navy-500">
          A negotiated price for one restaurant is set on that restaurant&rsquo;s page, not here.
        </p>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="GST"
        subtitle="Nothing is taxed before the Applies from date, even with Registered switched on. GST applies to the POS plan, add-ons, tablet rentals, e-bill charges and per-order charges. It is never added on top of printer prices, which already include it."
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
        {config.gst.registered && (
          <Warn>
            Before enabling GST: KnotKitchen must issue GST invoices for per-order and e-bill charges. That consolidated
            usage invoice is not built yet (see remaining.md). Plan, add-on, tablet and printer invoices already carry
            GST.
          </Warn>
        )}
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
        <div className="grid gap-3 sm:grid-cols-2">
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
        <Field
          label="Invoice address"
          hint="KnotKitchen's address on every invoice, one line per row."
          error={fieldErrors["gst.addressLines"]}
        >
          <textarea
            className={input}
            rows={3}
            value={(config.gst.addressLines || []).join("\n")}
            onChange={(e) => set({ gst: { ...config.gst, addressLines: e.target.value.split("\n") } })}
            placeholder={"J/183 Baishnabghata Patuli\nKolkata – 700094"}
          />
        </Field>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Per-order charge"
        priceNotice
        subtitle="Deducted from the store's wallet, + GST where applicable, for each qualifying paid order. Only orders paid online through the gateway are charged."
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
          label="Charge per paid online order"
          hint="Nothing is charged before the start date. A store can be given a later start on its own page."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (₹)" hint="Default ₹9" error={fieldErrors["websiteOrderCharge.amount"]}>
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
          <Field
            label="Starts on"
            hint="Required when the charge is on."
            error={fieldErrors["websiteOrderCharge.effectiveFrom"]}
          >
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
            Only orders paid online through the gateway are charged. Cash, card at the counter and
            pay-at-pickup orders never are, and neither are cancelled, refunded or unpaid ones.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {ORDER_SOURCES.map(({ value: source, label }) => {
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
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Per e-bill charge"
        priceNotice
        subtitle="Deducted from the store's wallet, + GST where applicable, per e-bill accepted for sending — never for a send that is refused."
        warn={
          config.ebillCharge.enabled && !Number(config.ebillCharge.amount)
            ? "The charge is on but set to zero, so e-bills cost nothing."
            : null
        }
      >
        <Toggle
          checked={config.ebillCharge.enabled}
          onChange={(v) => set({ ebillCharge: { ...config.ebillCharge, enabled: v } })}
          label="Charge per e-bill sent"
          hint="Each e-bill accepted for sending is charged, including a deliberate re-send. Nothing is charged before the start date."
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Amount (₹)" hint="Default ₹0.25" error={fieldErrors["ebillCharge.amount"]}>
            <input
              className={input}
              type="number"
              min="0"
              step="0.01"
              value={config.ebillCharge.amount}
              onChange={(e) => set({ ebillCharge: { ...config.ebillCharge, amount: e.target.value } })}
            />
          </Field>
          <Field
            label="Starts on"
            hint="Required when the charge is on."
            error={fieldErrors["ebillCharge.effectiveFrom"]}
          >
            <input
              className={input}
              type="date"
              value={asInputDate(config.ebillCharge.effectiveFrom)}
              onChange={(e) =>
                set({
                  ebillCharge: { ...config.ebillCharge, effectiveFrom: e.target.value || null },
                })
              }
            />
          </Field>
          <Field label="GST on this charge">
            <select
              className={input}
              value={config.ebillCharge.taxable ? "yes" : "no"}
              onChange={(e) =>
                set({
                  ebillCharge: { ...config.ebillCharge, taxable: e.target.value === "yes" },
                })
              }
            >
              <option value="yes">Taxable</option>
              <option value="no">Not taxable</option>
            </select>
          </Field>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- */}
      <Card
        title="Billing rules"
        subtitle="How periods, late payment and locks behave. The wallet renews the plan, add-ons and tablets automatically at the end of each period."
      >
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
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="text-xs font-semibold text-navy-700">Late renewal</span>
            <p className="mt-1 text-sm text-navy-800">
              Late renewals start on the payment day. A renewal is never backdated (agreement 6.4).
            </p>
          </div>
          <div>
            <span className="text-xs font-semibold text-navy-700">What a lock blocks</span>
            <p className="mt-1 text-sm text-navy-800">
              After the {config.graceHours}-hour grace period a lock blocks the POS except sign-in
              and Billing, and takes the store&rsquo;s website offline (table QR ordering and booking
              stop). It lifts as soon as the store pays.
            </p>
          </div>
        </div>
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
