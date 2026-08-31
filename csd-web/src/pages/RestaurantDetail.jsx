import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  FiArrowLeft, FiExternalLink, FiMapPin, FiGlobe, FiMonitor, FiEdit2,
  FiUsers, FiClock, FiAlertTriangle, FiCheck, FiX,
} from "react-icons/fi";
import { restaurants as api, stores as storesApi, errorMessage, fieldErrors } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import ChargesDialog from "../components/ChargesDialog";
import CustomersDialog from "../components/CustomersDialog";
import StoreDocuments from "../components/StoreDocuments";
import { UsersPanel } from "../components/CatalogPanels";

const inr = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n || 0);
const dt = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const dOnly = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");

/** 24h "HH:mm" → "10:00 AM", per the spec's examples. */
const to12h = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m ?? 0).padStart(2, "0")} ${period}`;
};

const Card = ({ title, action, children, className = "" }) => (
  <section className={`rounded-2xl border border-navy-200 bg-white p-3.5 ${className}`}>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 border-b border-navy-100 py-1.5 last:border-b-0">
    <dt className="shrink-0 text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
    <dd className="text-right text-sm text-navy-900">{children ?? "—"}</dd>
  </div>
);

const Toggle = ({ on, label }) => (
  <div className="flex items-center justify-between gap-3 border-b border-navy-100 py-1.5 last:border-b-0">
    <span className="text-sm text-navy-800">{label}</span>
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${on ? "text-emerald-700" : "text-navy-400"}`}>
      {on ? <FiCheck size={14} aria-hidden="true" /> : <FiX size={14} aria-hidden="true" />}
      {on ? "Enabled" : "Disabled"}
    </span>
  </div>
);

/**
 * StoreStatusCard — admin-only control to disable, re-enable, or temporarily
 * close a store. Backend: PATCH /api/csd/stores/:storeId/status. A closed or
 * suspended store is immediately blocked from every POS entry point, so this
 * is a destructive-ish action and gets a confirm step + audit trail server-
 * side.
 */
const STATUS_OPTIONS = [
  { value: "active", label: "Active", hint: "Store operates normally." },
  { value: "suspended", label: "Disabled (suspended)", hint: "Blocks all POS sign-ins and hides the storefront. Use for policy violations." },
  { value: "closed_temporarily", label: "Closed temporarily", hint: "Same block as suspended, but framed to staff as an operator-side pause (staff training, renovation)." },
  { value: "closed_until", label: "Closed until a date", hint: "Auto-reopens after the chosen date passes." },
];

const StoreStatusCard = ({ storeId, current, onChanged }) => {
  const [next, setNext] = useState(current);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { setNext(current); }, [current]);

  const dirty = next !== current;
  const requiresUntil = next === "closed_until";
  const requiresReason = next !== "active";

  const submit = async () => {
    setMsg("");
    if (requiresReason && !reason.trim()) return setMsg("A reason is required when changing away from Active.");
    if (requiresUntil && !until) return setMsg("Pick the reopening date.");
    if (!window.confirm(`Change store ${storeId} status to "${next}"? This is audited.`)) return;
    setBusy(true);
    try {
      await storesApi.updateStatus(storeId, {
        status: next,
        reason: reason.trim() || undefined,
        closedUntil: requiresUntil ? new Date(until).toISOString() : undefined,
      });
      setReason("");
      setUntil("");
      setMsg("Status updated.");
      onChanged && onChanged();
    } catch (err) {
      setMsg(errorMessage(err, "Could not update status."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Store status" className="mt-3">
      <p className="text-sm text-navy-500">
        Change the operating status of this store. Disabling or closing takes effect immediately
        across the POS, storefront and CSD lookups.
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-navy-500">New status</label>
          <select
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-brand-500 focus:outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-navy-500">
            {STATUS_OPTIONS.find((o) => o.value === next)?.hint}
          </p>
        </div>

        {requiresReason && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-navy-500">
              Reason (shown to store staff)
            </label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Compliance review pending"
              className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-brand-500 focus:outline-none"
              maxLength={500}
            />
          </div>
        )}

        {requiresUntil && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-navy-500">Reopens on</label>
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              min={new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-brand-500 focus:outline-none"
            />
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!dirty || busy}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${
            !dirty || busy ? "cursor-not-allowed bg-navy-300" : next === "active" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
          }`}
        >
          {busy ? "Saving…" : dirty ? `Apply: ${STATUS_OPTIONS.find((o) => o.value === next)?.label}` : "No changes"}
        </button>

        {msg && (
          <p className={`text-sm ${msg === "Status updated." ? "text-emerald-700" : "text-red-600"}`}>
            {msg}
          </p>
        )}
      </div>
    </Card>
  );
};

const PERIODS = [
  { key: "month", label: "Last month" },
  { key: "week", label: "Last week" },
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today" },
];

const RestaurantDetail = () => {
  const { storeId } = useParams();
  const { isAdmin } = useAuth();

  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [period, setPeriod] = useState("today");
  const [customerCount, setCustomerCount] = useState(null);
  const [staff, setStaff] = useState([]);
  const [activity, setActivity] = useState([]);
  const [dialog, setDialog] = useState(null); // 'charges' | 'customers' | 'gbp'
  const [openingPos, setOpeningPos] = useState(false);
  const [gbpUrl, setGbpUrl] = useState("");
  const [gbpErr, setGbpErr] = useState("");
  const [savingGbp, setSavingGbp] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get(storeId);
      setData(d);
      setGbpUrl(d.googleBusiness.url || "");
    } catch (err) {
      setError(errorMessage(err, "Could not load this restaurant."));
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.orderSummary(storeId, period).then(setSummary).catch(() => setSummary(null));
  }, [storeId, period]);

  useEffect(() => {
    api.customers(storeId, { limit: 1 }).then((d) => setCustomerCount(d.total)).catch(() => setCustomerCount(null));
    api.staff(storeId).then((d) => setStaff(d.staff)).catch(() => setStaff([]));
    api.activity(storeId).then((d) => setActivity(d.entries)).catch(() => setActivity([]));
  }, [storeId]);

  const saveGbp = async (e) => {
    e.preventDefault();
    setSavingGbp(true);
    setGbpErr("");
    try {
      await api.updateGoogleBusiness(storeId, gbpUrl.trim());
      await load();
      setDialog(null);
    } catch (err) {
      setGbpErr(fieldErrors(err).googleBusinessUrl || errorMessage(err));
    } finally {
      setSavingGbp(false);
    }
  };

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/stores" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
          <FiArrowLeft aria-hidden="true" /> Back to stores
        </Link>
        <p className="mt-6 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-navy-500">Loading restaurant…</p>;

  const { header, basic, owner, sales, contact, googleBusiness, websiteSettings, storeProperties, charges } = data;

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/stores" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
        <FiArrowLeft aria-hidden="true" /> Back to stores
      </Link>

      {/* ── Header (§18) ─────────────────────────────────────────────── */}
      <header className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-navy-200 bg-white p-3.5">
        {header.logoUrl ? (
          <img src={header.logoUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-navy-100 text-xl font-bold text-navy-500">
            {(header.restaurantName || "?").slice(0, 1).toUpperCase()}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-navy-900">{header.restaurantName}</h1>
          <p className="mt-0.5 text-sm text-navy-500">
            Store ID: <span className="font-mono">{header.storeId}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
            header.isActive ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-red-600/20"
          }`}>
            <span aria-hidden="true">{header.isActive ? "🟢" : "🔴"}</span>
            {header.isActive ? "Active" : "Disabled"}
          </span>

          {/* Computed live from configured hours, not a stored flag. */}
          <span
            title={header.availability.reason || `Timezone: ${header.availability.timezone}`}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset ${
              header.availability.isOpen ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-red-50 text-red-700 ring-red-600/20"
            }`}>
            <span aria-hidden="true">{header.availability.isOpen ? "🟢" : "🔴"}</span>
            {header.availability.isOpen ? "Open Now" : "Closed Now"}
          </span>
        </div>
      </header>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {/* ── Row 1 ─────────────────────────────────────────────────── */}
        <Card title="Basic information">
          <dl>
            <Row label="Restaurant">{basic.restaurantName}</Row>
            <Row label="Store ID"><span className="font-mono">{basic.storeId}</span></Row>
            <Row label="Type">{basic.restaurantType || "—"}</Row>
            <Row label="Restaurant phone">{basic.restaurantPhone ? `+91 ${basic.restaurantPhone}` : "—"}</Row>
            <Row label="Website">
              {basic.website ? (
                <a href={basic.website} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                  {basic.website.replace(/^https?:\/\//, "")} <FiExternalLink size={12} aria-hidden="true" />
                </a>
              ) : "—"}
            </Row>
            <Row label="Address">{basic.address.full || "—"}</Row>
            <Row label="City">{basic.address.city || "—"}</Row>
            <Row label="State">{basic.address.state || "—"}</Row>
            <Row label="PIN code">{basic.address.postalCode || "—"}</Row>
            <Row label="Status"><StatusBadge status={basic.status} /></Row>
            <Row label="Availability">
              {header.availability.isOpen ? "Open now" : `Closed now${header.availability.reason ? ` — ${header.availability.reason}` : ""}`}
            </Row>
            <Row label="Registered">{dOnly(basic.registeredOn)}</Row>
          </dl>
        </Card>

        <Card title="Quick access">
          <div className="space-y-2">
            <a
              href={googleBusiness.url || undefined}
              target="_blank" rel="noopener noreferrer"
              aria-disabled={!googleBusiness.url}
              onClick={(e) => { if (!googleBusiness.url) e.preventDefault(); }}
              className={`flex items-center gap-3 rounded-xl border p-2.5 ${
                googleBusiness.url ? "border-navy-200 hover:bg-navy-50" : "cursor-not-allowed border-navy-100 opacity-50"
              }`}>
              <FiMapPin className="shrink-0 text-brand-600" size={20} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy-900">Google Business</span>
                <span className="block truncate text-xs text-navy-500">
                  {googleBusiness.url ? "Open the listing" : "No URL configured"}
                </span>
              </span>
              {googleBusiness.url && <FiExternalLink className="shrink-0 text-navy-400" aria-hidden="true" />}
            </a>

            <a
              href={basic.website || undefined}
              target="_blank" rel="noopener noreferrer"
              aria-disabled={!basic.website}
              onClick={(e) => { if (!basic.website) e.preventDefault(); }}
              className={`flex items-center gap-3 rounded-xl border p-2.5 ${
                basic.website ? "border-navy-200 hover:bg-navy-50" : "cursor-not-allowed border-navy-100 opacity-50"
              }`}>
              <FiGlobe className="shrink-0 text-brand-600" size={20} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy-900">Restaurant website</span>
                <span className="block truncate text-xs text-navy-500">
                  {basic.website ? basic.website.replace(/^https?:\/\//, "") : "Not configured"}
                </span>
              </span>
              {basic.website && <FiExternalLink className="shrink-0 text-navy-400" aria-hidden="true" />}
            </a>

            <button
              type="button"
              disabled={openingPos}
              onClick={async () => {
                setOpeningPos(true);
                try {
                  const s = await api.openPos(storeId, "Admin quick-open (CSD)");
                  const url = s.impersonateUrl || s.fallbackUrl;
                  if (!url) throw new Error("No POS URL returned.");
                  window.open(url, "_blank", "noopener,noreferrer");
                } catch (err) {
                  window.alert(errorMessage(err, "Could not open POS."));
                } finally {
                  setOpeningPos(false);
                }
              }}
              className="flex w-full items-center gap-3 rounded-xl border border-navy-200 p-2.5 text-left hover:bg-navy-50 disabled:cursor-wait disabled:opacity-60"
            >
              <FiMonitor className="shrink-0 text-brand-600" size={20} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy-900">
                  {openingPos ? "Opening POS…" : "Open POS"}
                </span>
                <span className="block text-xs text-navy-500">
                  Opens in a new tab, signed in as the store's Owner. Recorded against your name.
                </span>
              </span>
            </button>

            {isAdmin && (
              <button type="button" onClick={() => setDialog("gbp")}
                className="w-full text-right text-xs font-semibold text-brand-600 hover:text-brand-700">
                {googleBusiness.url ? "Edit" : "Add"} Google Business URL
              </button>
            )}
          </div>
        </Card>

        {/* ── Row 2 ─────────────────────────────────────────────────── */}
        <Card title="Owner &amp; sales">
          <dl>
            <Row label="Owner name">{owner.name || "—"}</Row>
            <Row label="Owner phone">{owner.phone ? `+91 ${owner.phone}` : "—"}</Row>
            <Row label="Owner email">{owner.email || "—"}</Row>
            <Row label="Sales agent">
              {sales.agentName || <span className="text-navy-400">Not recorded</span>}
            </Row>
          </dl>
        </Card>

        <Card title="Contact numbers">
          <dl>
            <Row label="Owner (personal)">{contact.ownerPhone ? `+91 ${contact.ownerPhone}` : "—"}</Row>
            <Row label="Restaurant (business)">{contact.restaurantPhone ? `+91 ${contact.restaurantPhone}` : "—"}</Row>
          </dl>
          <p className="mt-3 text-xs text-navy-400">
            Kept separate — the owner's personal number and the restaurant's line are often different.
          </p>
        </Card>

        {/* ── Row 3 ─────────────────────────────────────────────────── */}
        <Card
          title="Customers"
          action={
            <button type="button" onClick={() => setDialog("customers")}
              className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              View customers
            </button>
          }>
          <div className="flex items-center gap-4">
            <FiUsers className="shrink-0 text-navy-300" size={36} aria-hidden="true" />
            <div>
              <p className="text-3xl font-bold text-navy-900">
                {customerCount === null ? "—" : new Intl.NumberFormat("en-IN").format(customerCount)}
              </p>
              <p className="text-sm text-navy-500">unique customers</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-navy-400">
            Counted by phone number across website, POS and table orders, so one person ordering
            through two channels counts once.
          </p>
        </Card>

        <Card title="Order summary">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  period === p.key ? "bg-brand-600 text-white" : "bg-navy-100 text-navy-700 hover:bg-navy-200"
                }`}>
                {p.label}
              </button>
            ))}
          </div>
          {!summary ? (
            <p className="text-sm text-navy-500">Loading…</p>
          ) : (
            <dl>
              <Row label="Website orders">{summary.websiteOrders}</Row>
              <Row label="POS orders">{summary.posOrders}</Row>
              <Row label="Table orders">{summary.tableOrders}</Row>
              <Row label="Total">
                <span className="text-lg font-bold">{summary.totalOrders}</span>
              </Row>
              <Row label="Revenue">{inr(summary.revenue)}</Row>
            </dl>
          )}
        </Card>

        {/* ── Row 4 ─────────────────────────────────────────────────── */}
        <Card title="Website settings">
          <Toggle on={websiteSettings.delivery} label="Delivery" />
          <Toggle on={websiteSettings.collection} label="Collection" />
          <Toggle on={websiteSettings.tableOrders} label="Table orders" />
          <Toggle on={websiteSettings.websiteEnabled} label="Website published" />
        </Card>

        <Card title="Store properties">
          <dl className="mb-3">
            <Row label="Food prep time">
              {storeProperties.timings.prepMinutes != null ? `${storeProperties.timings.prepMinutes} min` : "—"}
            </Row>
            <Row label="Auto-ready — delivery">
              {storeProperties.timings.autoReady.delivery != null ? `${storeProperties.timings.autoReady.delivery} min` : "—"}
            </Row>
            <Row label="Auto-ready — collection">
              {storeProperties.timings.autoReady.collection != null ? `${storeProperties.timings.autoReady.collection} min` : "—"}
            </Row>
            <Row label="Auto-ready — table">
              {storeProperties.timings.autoReady.table != null ? `${storeProperties.timings.autoReady.table} min` : "—"}
            </Row>
            <Row label="Currently">{header.availability.isOpen ? "Open" : "Closed"}</Row>
          </dl>

          {!storeProperties.timings.hasConfiguredMinMax && (
            <p className="mb-3 text-xs text-navy-400">
              The platform stores a prep time and auto-ready windows rather than separate
              minimum/maximum delivery and collection times, so those are shown above as they are
              actually configured.
            </p>
          )}

          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-navy-500">
            Operating hours
          </h3>
          {!storeProperties.usesBusinessHours && (
            <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" aria-hidden="true" />
              Business hours are not enforced for this store — it accepts orders at any time,
              regardless of the schedule below.
            </p>
          )}
          <ul className="text-sm">
            {storeProperties.openingHours.map((h) => (
              <li key={h.day} className="flex justify-between border-b border-navy-100 py-1.5 last:border-b-0">
                <span className="text-navy-700">{h.label}</span>
                <span className={h.isOpen === false ? "text-navy-400" : "text-navy-900"}>
                  {h.isOpen === false
                    ? "Closed"
                    : h.openTime
                      ? `${to12h(h.openTime)} → ${to12h(h.closeTime)}`
                      : "Not set"}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        {/* ── Row 5 ─────────────────────────────────────────────────── */}
        <Card
          title="Store charges"
          action={
            // §29 — Edit is admin-only. Staff see the figures, no controls.
            charges.canEdit ? (
              <button type="button" onClick={() => setDialog("charges")}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:text-brand-700">
                <FiEdit2 size={12} aria-hidden="true" /> Edit
              </button>
            ) : null
          }>
          <dl>
            <Row label="Online paid orders">
              {inr(charges.onlinePaidOrderCharge)} + GST / order
            </Row>
            <Row label="GST">{charges.gstPercent}%</Row>
            <Row label="Current plan"><span className="capitalize">{charges.plan}</span></Row>
            <Row label="Monthly subscription">{inr(charges.monthlySubscription)} + GST</Row>
          </dl>
          {charges.usingDefaults && (
            <p className="mt-3 text-xs text-navy-400">
              Using platform defaults — no restaurant-specific pricing has been set.
            </p>
          )}
          {!charges.canEdit && (
            <p className="mt-3 text-xs text-navy-400">
              Only an administrator can change charges or the subscription.
            </p>
          )}
        </Card>

        <Card title="Restaurant staff">
          {staff.length === 0 ? (
            <p className="text-sm text-navy-400">No staff records.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th scope="col" className="pb-2">Name</th>
                    <th scope="col" className="pb-2">Role</th>
                    <th scope="col" className="pb-2">Added</th>
                    <th scope="col" className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s, i) => (
                    <tr key={s.id || `owner-${i}`} className="border-t border-navy-100">
                      <td className="py-2 text-navy-900">
                        {s.name}
                        {s.synthesised && (
                          <span className="ml-1.5 text-xs text-navy-400" title="No POS account — shown from the store record">
                            (no POS account)
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-navy-700">{s.role}</td>
                      <td className="py-2 text-xs text-navy-500">{dOnly(s.addedDate)}</td>
                      <td className="py-2"><StatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-navy-400">
            These accounts belong to the restaurant and are managed from their own POS.
          </p>
        </Card>
      </div>

      {/* ── Documents (§30) ──────────────────────────────────────────── */}
      <div className="mt-3">
        <StoreDocuments storeId={storeId} />
      </div>

      {/* ── POS users ──────────────────────────────────────────────────── */}
      <div className="mt-3 space-y-3">
        <UsersPanel storeId={storeId} />
      </div>

      {/* ── Store status control (admin only) ─────────────────────────── */}
      {isAdmin && (
        <StoreStatusCard
          storeId={storeId}
          current={basic.status}
          onChanged={load}
        />
      )}

      {/* ── Activity (§33) ───────────────────────────────────────────── */}
      <Card title="Restaurant activity" className="mt-3">
        {activity.length === 0 ? (
          <p className="text-sm text-navy-400">No activity recorded for this restaurant yet.</p>
        ) : (
          <ul className="space-y-3">
            {activity.map((a, i) => (
              <li key={i} className="flex gap-3">
                <FiClock className="mt-0.5 shrink-0 text-navy-300" size={14} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                      a.severity === "WARNING" ? "bg-amber-100 text-amber-800" : "bg-navy-100 text-navy-700"
                    }`}>{a.action}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-navy-800">{a.description}</p>
                  <p className="text-xs text-navy-400">
                    {a.by ? `${a.by} · ` : ""}{dt(a.at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Dialogs ──────────────────────────────────────────────────── */}
      {dialog === "charges" && (
        <ChargesDialog storeId={storeId} charges={charges}
          onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />
      )}
      {dialog === "customers" && (
        <CustomersDialog storeId={storeId} onClose={() => setDialog(null)} />
      )}
      {dialog === "gbp" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form onSubmit={saveGbp} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="mb-3 text-lg font-bold text-navy-900">Google Business URL</h2>
            <input value={gbpUrl} onChange={(e) => { setGbpUrl(e.target.value); setGbpErr(""); }}
              placeholder="https://maps.google.com/…" aria-label="Google Business URL"
              className={`w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none ${
                gbpErr ? "border-red-400" : "border-navy-200 focus:border-brand-500"
              }`} />
            {gbpErr && <p className="mt-1 text-xs text-red-600">{gbpErr}</p>}
            <p className="mt-2 text-xs text-navy-400">Leave empty to remove the link.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setDialog(null)} disabled={savingGbp}
                className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
                Cancel
              </button>
              <button type="submit" disabled={savingGbp}
                className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                {savingGbp ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default RestaurantDetail;
