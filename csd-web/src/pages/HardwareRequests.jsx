import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FiChevronLeft, FiChevronRight, FiAlertCircle } from "react-icons/fi";
import { hardwareRequests as hwApi, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import { dt } from "../lib/format";

/**
 * Printers and tablets stores asked for (and paid for) from POS Billing.
 * The queue opens on what needs someone: new requests, oldest first.
 */
const TABS = [
  { key: "REQUESTED", label: "New" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "DISPATCHED", label: "On the way" },
  { key: "DELIVERED", label: "Delivered" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "", label: "All" },
];

const DAY = 24 * 60 * 60 * 1000;
/** A paid request nobody has picked up for a day is late. */
const waiting = (r) => r.status === "REQUESTED" && Date.now() - new Date(r.createdAt).getTime() > DAY;

const HardwareRequests = () => {
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "REQUESTED";
  const storeId = params.get("storeId") || "";
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  // Only the latest query's answer is shown: a slow earlier one arriving last is dropped.
  const seq = useRef(0);

  const load = useCallback(
    async (page = 1) => {
      const mine = ++seq.current;
      setBusy(true);
      setError("");
      try {
        const query = { page, limit: 25 };
        if (status) query.status = status;
        if (type) query.type = type;
        if (storeId) query.storeId = storeId;
        if (q.trim()) query.q = q.trim();
        const res = await hwApi.list(query);
        if (mine === seq.current) setData(res);
      } catch (err) {
        if (mine === seq.current) setError(errorMessage(err, "Could not load the requests."));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [status, type, storeId, q]
  );

  useEffect(() => {
    const t = setTimeout(() => load(1), 250);
    return () => clearTimeout(t);
  }, [load]);

  const setParam = (k, v) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const counts = data?.counts || {};

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-navy-900">Hardware requests</h1>
        <p className="mt-1 text-sm text-navy-500">
          Printers and tablets stores have paid for from POS Billing. Accept, dispatch with tracking, and mark delivered;
          the store follows every step on its Billing page.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Status">
        {TABS.map((t) => {
          const on = status === t.key;
          const n = t.key ? counts[t.key] : null;
          return (
            <button
              key={t.key || "all"}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setParam("status", t.key)}
              className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold ${
                on ? "bg-navy-900 text-white" : "border border-navy-200 bg-white text-navy-700 hover:bg-navy-50"
              }`}
            >
              {t.label}
              {n > 0 && ["REQUESTED", "ACCEPTED", "DISPATCHED"].includes(t.key) && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${on ? "bg-white/20" : "bg-brand-600 text-white"}`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-navy-200 bg-white p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search request no., store name, store ID or phone…"
          aria-label="Search requests"
          className="min-w-[14rem] flex-1 rounded-xl border border-navy-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Filter by item"
          className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
        >
          <option value="">Printers and tablets</option>
          <option value="PRINTER">Printers</option>
          <option value="TABLET">Tablets</option>
        </select>
        {storeId && (
          <button
            type="button"
            onClick={() => setParam("storeId", null)}
            className="rounded-xl border border-navy-200 px-3 py-2 text-sm text-navy-700 hover:bg-navy-50"
          >
            Store {storeId} ✕
          </button>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {busy && !data && <p className="mt-6 text-sm text-navy-500">Loading requests…</p>}

      {data && data.results.length === 0 && (
        <p className="mt-6 rounded-2xl border border-navy-200 bg-white p-8 text-center text-sm text-navy-500">
          {status === "REQUESTED" ? "No new requests. All caught up." : "No requests match these filters."}
        </p>
      )}

      {data && data.results.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-200 bg-white">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Request</th>
                  <th scope="col" className="px-4 py-3">Store</th>
                  <th scope="col" className="px-4 py-3">Item</th>
                  <th scope="col" className="px-4 py-3 text-right">Paid</th>
                  <th scope="col" className="px-4 py-3">Deliver to</th>
                  <th scope="col" className="px-4 py-3">Requested</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((r) => (
                  <tr key={r.id} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <Link to={`/hardware/${r.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-700">
                        {r.requestNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-navy-700">
                      <div>{r.restaurantName || "—"}</div>
                      <div className="font-mono text-xs text-navy-400">{r.storeId}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/hardware/${r.id}`} className="font-medium text-navy-900 hover:text-brand-700">
                        {r.item.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-navy-900">{r.payment.amount.label}</td>
                    <td className="px-4 py-3 text-navy-700">
                      {[r.shipTo.city, r.shipTo.postalCode].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={waiting(r) ? "inline-flex items-center gap-1 font-medium text-red-600" : "text-navy-600"}>
                        {waiting(r) && <FiAlertCircle size={12} aria-hidden="true" />}
                        {dt(r.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status.toLowerCase()} />
                      {r.status === "DISPATCHED" && r.dispatch?.courier && (
                        <div className="mt-0.5 text-xs text-navy-400">{r.dispatch.courier}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" disabled={data.page <= 1 || busy} onClick={() => load(data.page - 1)}
                className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
                <FiChevronLeft />
              </button>
              <span className="text-sm text-navy-600">{data.page} / {data.pages}</span>
              <button type="button" disabled={data.page >= data.pages || busy} onClick={() => load(data.page + 1)}
                className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
                <FiChevronRight />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default HardwareRequests;
