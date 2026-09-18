import React, { useEffect, useState } from "react";
import { FiX, FiChevronLeft, FiChevronRight, FiDownload } from "react-icons/fi";
import { restaurants as api, errorMessage } from "../api";
import { dOnly, inr, num } from "../lib/format";


/** Map the stored `source` values onto the labels the spec uses. */
const SOURCE_LABEL = { WEBSITE: "Website", POS: "POS", QR: "Table", MARKETPLACE: "Marketplace", PHONE: "Phone" };

const CustomersDialog = ({ storeId, onClose }) => {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  // Customer details leave the system only from here, as a file, and the
  // server logs who took it.
  const exportCsv = async () => {
    setExporting(true);
    setError("");
    try {
      const blob = await api.customersCsv(storeId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-${storeId}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(errorMessage(err, "Could not export the customer list. Only an admin can."));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    let alive = true;
    api.customers(storeId, { page, limit: 25 })
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load customers.")));
    return () => { alive = false; };
  }, [storeId, page]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Customers"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-navy-200 p-5">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Customers</h2>
            <p className="text-sm text-navy-500">
              {data ? `${num(data.total)} unique` : "Loading…"}
              {" · "}Store <span className="font-mono">{storeId}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={exportCsv} disabled={exporting || !data || data.total === 0}
              className="flex items-center gap-1.5 rounded-lg border border-navy-300 px-3 py-1.5 text-sm font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-40">
              <FiDownload /> {exporting ? "Exporting…" : "Export CSV"}
            </button>
            <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
              <FiX size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!data && !error && <p className="text-sm text-navy-500">Loading…</p>}

          {data && data.customers.length === 0 && (
            <p className="py-8 text-center text-sm text-navy-500">
              No customers have ordered from this restaurant yet.
            </p>
          )}

          {data && data.customers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th scope="col" className="pb-2">Customer</th>
                    <th scope="col" className="pb-2">Phone</th>
                    <th scope="col" className="pb-2">Source</th>
                    <th scope="col" className="pb-2 text-right">Orders</th>
                    <th scope="col" className="pb-2 text-right">Spent</th>
                    <th scope="col" className="pb-2">Last order</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map((c) => (
                    <tr key={c.phone} className="border-t border-navy-100">
                      <td className="py-2.5 text-navy-900">{c.name || <span className="text-navy-400">Not given</span>}</td>
                      <td className="py-2.5 text-navy-700">{c.phone}</td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {c.sources.map((s) => (
                            <span key={s} className="rounded-full bg-navy-100 px-2 py-0.5 text-[11px] text-navy-700">
                              {SOURCE_LABEL[s] || s}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="py-2.5 text-right font-semibold text-navy-900">{c.totalOrders}</td>
                      <td className="py-2.5 text-right text-navy-700">{inr(c.totalSpent)}</td>
                      <td className="py-2.5 text-xs text-navy-600">{dOnly(c.lastOrderDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {data && data.pages > 1 && (
          <footer className="flex items-center justify-end gap-2 border-t border-navy-200 p-3">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
              <FiChevronLeft />
            </button>
            <span className="text-sm text-navy-600">{data.page} / {data.pages}</span>
            <button type="button" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
              <FiChevronRight />
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};

export default CustomersDialog;
