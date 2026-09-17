import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { reports, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import { inrWhole as inr, num, dt } from "../lib/format";


const Card = ({ title, children, className = "" }) => (
  <section className={`rounded-2xl border border-navy-200 bg-white p-5 ${className}`}>
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-700">{title}</h2>
    {children}
  </section>
);

const Split = ({ rows, empty }) => {
  if (!rows?.length) return <p className="text-sm text-navy-400">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.orders), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="capitalize text-navy-800">{r.label}</span>
            <span className="text-navy-600">{num(r.orders)} · {inr(r.revenue)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-navy-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.orders / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

const Reports = () => {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditAction, setAuditAction] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    reports.get({ months })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load reports.")));
    return () => { alive = false; };
  }, [months]);

  const loadAudit = (page = 1, action = auditAction) => {
    reports.audit({ page, limit: 25, action: action || undefined })
      .then(setAudit)
      .catch((err) => setError(errorMessage(err, "Could not load the activity log.")));
  };

  useEffect(() => { loadAudit(1, auditAction); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [auditAction]);

  if (error && !data) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-navy-500">Loading reports…</p>;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Reports</h1>
          <p className="mt-1 text-sm text-navy-500">
            Last {data.period.months} months · {data.period.timezone} · cancellations excluded from revenue
          </p>
        </div>
        <label className="text-sm">
          <span className="mr-2 text-navy-600">Period</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
            className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500">
            {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} months</option>)}
          </select>
        </label>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Top restaurants by revenue" className="lg:col-span-2">
          {data.topStores.length === 0 ? (
            <p className="text-sm text-navy-400">No orders in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th scope="col" className="pb-2">Restaurant</th>
                    <th scope="col" className="pb-2">Status</th>
                    <th scope="col" className="pb-2 text-right">Orders</th>
                    <th scope="col" className="pb-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topStores.map((s) => (
                    <tr key={s.storeId} className="border-t border-navy-100">
                      <td className="py-2.5">
                        <Link to={`/stores/${s.storeId}`} className="font-medium text-navy-900 hover:text-brand-700">
                          {s.storeName || s.storeId}
                        </Link>
                        <span className="ml-1.5 font-mono text-xs text-navy-400">{s.storeId}</span>
                      </td>
                      <td className="py-2.5"><StatusBadge status={s.status} /></td>
                      <td className="py-2.5 text-right text-navy-700">{num(s.orders)}</td>
                      <td className="py-2.5 text-right font-semibold text-navy-900">{inr(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Cancellations">
          <p className="text-3xl font-bold text-navy-900">{num(data.cancellations.orders)}</p>
          <p className="mt-1 text-sm text-navy-500">
            orders worth {inr(data.cancellations.value)}
          </p>
          <p className="mt-3 text-xs text-navy-400">
            Reported separately because they are excluded from every revenue figure above.
          </p>
        </Card>

        <Card title="By order type"><Split rows={data.byOrderType} empty="No orders in this period." /></Card>
        <Card title="By channel"><Split rows={data.bySource} empty="No orders in this period." /></Card>

        <Card title="Jobs">
          {data.jobs.byStatus.length === 0 ? (
            <p className="text-sm text-navy-400">No jobs recorded.</p>
          ) : (
            <ul className="space-y-2">
              {data.jobs.byStatus.map((j) => (
                <li key={j.status} className="flex items-center justify-between">
                  <StatusBadge status={j.status} />
                  <span className="font-semibold text-navy-900">{num(j.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Jobs by assignee" className="lg:col-span-2">
          {data.jobs.byAssignee.length === 0 ? (
            <p className="text-sm text-navy-400">No jobs assigned yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.jobs.byAssignee.map((a) => (
                <li key={a.staffId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-navy-800">
                    {a.name} <span className="font-mono text-xs text-navy-400">{a.staffId}</span>
                  </span>
                  <span className="text-navy-600">
                    {num(a.closed)} closed · {num(a.open)} open
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Staff activity">
          {data.staffActivity.length === 0 ? (
            <p className="text-sm text-navy-400">No recorded actions.</p>
          ) : (
            <>
              <ul className="space-y-2 text-sm">
                {data.staffActivity.map((a, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate text-navy-800">{a.name}</span>
                    <span className="text-navy-600">{num(a.actions)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-navy-400">
                Counts audited actions only — an activity signal, not a performance measure.
              </p>
            </>
          )}
        </Card>
      </div>

      {/* Activity log */}
      <section className="mt-6 rounded-2xl border border-navy-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-200 p-5">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-navy-700">Activity log</h2>
            <p className="text-xs text-navy-500">Append-only. Entries cannot be edited or deleted.</p>
          </div>
          <select value={auditAction} onChange={(e) => setAuditAction(e.target.value)}
            aria-label="Filter by action"
            className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500">
            <option value="">All actions</option>
            {(audit?.actions || []).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </header>

        {!audit ? (
          <p className="p-5 text-sm text-navy-500">Loading…</p>
        ) : audit.entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-500">No activity recorded yet.</p>
        ) : (
          <>
            <ul className="divide-y divide-navy-100">
              {audit.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold ${
                        e.severity === "WARNING" ? "bg-amber-100 text-amber-800" : "bg-navy-100 text-navy-700"
                      }`}>{e.action}</span>
                      {e.storeId && <span className="font-mono text-[11px] text-navy-400">{e.storeId}</span>}
                    </div>
                    <p className="mt-1 text-sm text-navy-800">{e.description}</p>
                  </div>
                  <div className="text-right text-xs text-navy-400">
                    <div>{dt(e.timestamp)}</div>
                    <div className="font-mono">{e.role}</div>
                  </div>
                </li>
              ))}
            </ul>
            {audit.pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t border-navy-100 p-3">
                <button type="button" disabled={audit.page <= 1} onClick={() => loadAudit(audit.page - 1)}
                  className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
                  <FiChevronLeft />
                </button>
                <span className="text-sm text-navy-600">{audit.page} / {audit.pages}</span>
                <button type="button" disabled={audit.page >= audit.pages} onClick={() => loadAudit(audit.page + 1)}
                  className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
                  <FiChevronRight />
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default Reports;
