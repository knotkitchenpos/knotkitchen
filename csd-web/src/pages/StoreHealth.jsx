import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FiAlertTriangle, FiCreditCard, FiRefreshCw, FiShoppingBag, FiTablet, FiCalendar, FiSend, FiX } from "react-icons/fi";
import { health as healthApi, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * Store Health: active stores that need attention, worst first, and a way to
 * warn the owner on WhatsApp before they have to complain.
 */
const KINDS = {
  no_orders: { label: "No recent orders", Icon: FiShoppingBag },
  wallet_low: { label: "Wallet low", Icon: FiCreditCard },
  subscription_ending: { label: "Renewal at risk", Icon: FiCalendar },
  device_offline: { label: "Tablets offline", Icon: FiTablet },
};

const day = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

const Tile = ({ kind, count, active, onClick }) => {
  const { label, Icon } = KINDS[kind];
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-2xl border p-4 text-left ${active ? "border-brand-500 bg-brand-50" : "border-navy-200 bg-white hover:bg-navy-50"}`}>
      <Icon className="mb-2 text-navy-500" aria-hidden="true" />
      <div className="text-2xl font-bold text-navy-900">{count}</div>
      <div className="text-xs text-navy-500">{label}</div>
    </button>
  );
};

const StoreHealth = () => {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState(null); // { store, issue }

  const load = useCallback(async () => {
    try {
      setData(await healthApi.get());
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not load store health."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (data?.rows || []).filter((r) => !filter || r.issues.some((i) => i.kind === filter)), [data, filter]);
  const missing = useMemo(() => Object.values(data?.alerts?.kinds || {}).filter((k) => !k.ready), [data]);

  const send = async () => {
    const { store, issue } = confirm;
    setBusy(`${store.storeId}:${issue.kind}`);
    setConfirm(null);
    setNote("");
    setError("");
    try {
      await healthApi.sendAlert(store.storeId, issue.kind);
      setNote(`Alert sent to ${store.ownerName || store.storeName}. It is in their WhatsApp chat.`);
      load();
    } catch (err) {
      setError(errorMessage(err, "Could not send the alert."));
    } finally {
      setBusy("");
    }
  };

  const toggleAuto = async () => {
    try {
      await healthApi.setAuto(!data.alerts.autoEnabled);
      load();
    } catch (err) {
      setError(errorMessage(err, "Could not change that."));
    }
  };

  return (
    <div className="mx-auto max-w-[1600px]">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Store Health</h1>
          <p className="mt-1 text-sm text-navy-500">
            {data ? `${data.rows.length} of ${data.activeStores} active stores need attention.` : "Checking stores…"}
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-navy-200 bg-white px-3.5 py-2 text-sm font-semibold text-navy-700 hover:bg-navy-50">
          <FiRefreshCw aria-hidden="true" /> Refresh
        </button>
      </header>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {note && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{note}</p>}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.keys(KINDS).map((k) => (
              <Tile key={k} kind={k} count={data.counts[k] || 0} active={filter === k} onClick={() => setFilter(filter === k ? "" : k)} />
            ))}
          </div>

          {!data.devicesChecked && (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Tablets could not be checked just now, so offline tablets are not in this list.</p>
          )}

          {(missing.length > 0 || isAdmin) && (
            <section className="mb-4 rounded-2xl border border-navy-200 bg-white p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy-900">WhatsApp alerts to owners</p>
                  <p className="mt-0.5 text-navy-500">
                    Each store gets the same alert at most once in {data.alerts.cooldownDays} days. Automatic sending runs daily at 11 am.
                  </p>
                </div>
                {isAdmin && (
                  <button type="button" onClick={toggleAuto} aria-pressed={data.alerts.autoEnabled}
                    className={`rounded-xl px-3.5 py-2 text-sm font-semibold ${data.alerts.autoEnabled ? "bg-emerald-600 text-white hover:bg-emerald-500" : "border border-navy-200 text-navy-700 hover:bg-navy-50"}`}>
                    {data.alerts.autoEnabled ? "Automatic: On" : "Automatic: Off"}
                  </button>
                )}
              </div>
              {missing.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50 p-3 text-amber-900">
                  <p className="font-semibold">Waiting for WhatsApp to approve {missing.length === 1 ? "this template" : "these templates"}:</p>
                  <ul className="mt-1 space-y-1">
                    {missing.map((m) => (
                      <li key={m.template}><code>{m.template}</code>: {m.wording}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <div className="overflow-hidden rounded-2xl border border-navy-200 bg-white">
            {rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-navy-500">{filter ? "No stores with this problem." : "Every active store looks healthy."}</p>
            ) : (
              <ul>
                {rows.map((r) => (
                  <li key={r.storeId} className="border-b border-navy-100 p-4 last:border-b-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link to={`/stores/${r.storeId}`} className="font-semibold text-navy-900 hover:text-brand-600">{r.storeName}</Link>
                      <span className="font-mono text-xs text-navy-400">{r.storeId}</span>
                    </div>
                    <p className="text-xs text-navy-500">{r.ownerName} · {r.ownerPhone}</p>
                    <ul className="mt-2 space-y-1.5">
                      {r.issues.map((i) => {
                        const def = data.alerts.kinds[i.kind];
                        const last = r.lastAlerts?.[i.kind];
                        return (
                          <li key={i.kind} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy-50 px-3 py-2">
                            <span className="flex min-w-0 items-start gap-2 text-sm">
                              <FiAlertTriangle className={`mt-0.5 shrink-0 ${i.severity === "critical" ? "text-red-600" : "text-amber-500"}`} aria-label={i.severity} />
                              <span className="min-w-0">
                                <span className="font-semibold text-navy-900">{i.title}</span>
                                <span className="block text-xs text-navy-500">{i.detail}</span>
                              </span>
                            </span>
                            {def && (
                              last ? (
                                <span className="text-xs text-navy-500">Alerted {day(last)}</span>
                              ) : (
                                <button type="button" disabled={!def.ready || busy === `${r.storeId}:${i.kind}`}
                                  title={def.ready ? "Send a WhatsApp alert to the owner" : `Waiting for the template ${def.template}`}
                                  onClick={() => setConfirm({ store: r, issue: i })}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                                  <FiSend aria-hidden="true" /> Alert owner
                                </button>
                              )
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-label="Send alert" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-navy-900">Send this alert?</h2>
              <button type="button" onClick={() => setConfirm(null)} aria-label="Close" className="text-navy-400 hover:text-navy-700"><FiX size={20} /></button>
            </div>
            <p className="text-sm text-navy-600">
              A WhatsApp message goes to {confirm.store.ownerName} (+91 {confirm.store.ownerPhone}) about {confirm.store.storeName}: {confirm.issue.title.toLowerCase()}.
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button type="button" onClick={() => setConfirm(null)} className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
              <button type="button" onClick={send} className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500">Send alert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoreHealth;
