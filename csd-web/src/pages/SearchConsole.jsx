import React, { useState } from "react";
import { FiSearch, FiX, FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { orders, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import OrderDrawer from "../components/OrderDrawer";
import { inr, dt } from "../lib/format";

const EMPTY = {
  storeName: "", storeId: "", orderId: "", customerName: "", customerPhone: "",
  customerAddress: "", transactionId: "", dateFrom: "", dateTo: "",
  amountMin: "", amountMax: "", status: "",
};



const Input = ({ label, ...rest }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
      {label}
    </span>
    <input
      {...rest}
      className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none focus:border-brand-500"
    />
  </label>
);

/**
 * Search Console — order lookup across every store.
 *
 * Filters AND together and are submitted explicitly rather than as-you-type:
 * this queries the whole platform's order collection, so firing on every
 * keystroke would be needlessly expensive and would surface half-typed
 * filters as "no results".
 */
const SearchConsole = () => {
  const [form, setForm] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openOrderId, setOpenOrderId] = useState(null);

  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const run = async (page = 1) => {
    setBusy(true);
    setError("");
    try {
      const params = Object.fromEntries(
        Object.entries(form).filter(([, v]) => String(v).trim() !== "")
      );
      setData(await orders.search({ ...params, page, limit: 25 }));
    } catch (err) {
      setError(errorMessage(err, "Search failed."));
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    run(1);
  };

  const reset = () => {
    setForm(EMPTY);
    setData(null);
    setError("");
  };

  const activeCount = Object.values(form).filter((v) => String(v).trim() !== "").length;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-navy-900">Search Console</h1>
        <p className="mt-1 text-sm text-navy-500">
          Find orders across every restaurant. Combine as many filters as you need.
        </p>
      </header>

      <form onSubmit={submit} className="rounded-2xl border border-navy-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="Store name" name="storeName" value={form.storeName} onChange={set} />
          <Input label="Store ID" name="storeId" value={form.storeId} onChange={set} inputMode="numeric" maxLength={6} />
          <Input label="Order ID / number" name="orderId" value={form.orderId} onChange={set} />
          <Input label="Transaction ID" name="transactionId" value={form.transactionId} onChange={set} />

          <Input label="Customer name" name="customerName" value={form.customerName} onChange={set} />
          <Input label="Customer telephone" name="customerPhone" value={form.customerPhone} onChange={set} inputMode="numeric" />
          <div className="sm:col-span-2">
            <Input label="Customer address" name="customerAddress" value={form.customerAddress} onChange={set} />
          </div>

          <Input label="Order date from" name="dateFrom" type="date" value={form.dateFrom} onChange={set} />
          <Input label="Order date to" name="dateTo" type="date" value={form.dateTo} onChange={set} />
          <Input label="Amount min" name="amountMin" type="number" min="0" value={form.amountMin} onChange={set} />
          <Input label="Amount max" name="amountMax" type="number" min="0" value={form.amountMax} onChange={set} />

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Order status
            </span>
            <select
              name="status"
              value={form.status}
              onChange={set}
              className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 outline-none focus:border-brand-500"
            >
              <option value="">Any</option>
              {["Pending", "In Progress", "Ready", "Completed", "Cancelled"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy || activeCount === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
          >
            <FiSearch aria-hidden="true" /> {busy ? "Searching…" : "Search orders"}
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-navy-500 hover:text-navy-800"
            >
              <FiX aria-hidden="true" /> Clear {activeCount} filter{activeCount > 1 ? "s" : ""}
            </button>
          )}
          {activeCount === 0 && (
            <span className="text-xs text-navy-400">Apply at least one filter to search.</span>
          )}
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {data && (
        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-navy-600">
              <span className="font-semibold text-navy-900">{data.total}</span> order
              {data.total === 1 ? "" : "s"} found
            </p>
            {data.pages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" disabled={data.page <= 1 || busy} onClick={() => run(data.page - 1)}
                  className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
                  <FiChevronLeft />
                </button>
                <span className="text-sm text-navy-600">{data.page} / {data.pages}</span>
                <button type="button" disabled={data.page >= data.pages || busy} onClick={() => run(data.page + 1)}
                  className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
                  <FiChevronRight />
                </button>
              </div>
            )}
          </div>

          {data.results.length === 0 ? (
            <p className="rounded-2xl border border-navy-200 bg-white p-8 text-center text-sm text-navy-500">
              No orders match those filters.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-navy-200 bg-white">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">Order</th>
                    <th scope="col" className="px-4 py-3">Store</th>
                    <th scope="col" className="px-4 py-3">Customer</th>
                    <th scope="col" className="px-4 py-3">Phone</th>
                    <th scope="col" className="px-4 py-3">Date</th>
                    <th scope="col" className="px-4 py-3">Transaction</th>
                    <th scope="col" className="px-4 py-3 text-right">Amount</th>
                    <th scope="col" className="px-4 py-3">Order</th>
                    <th scope="col" className="px-4 py-3">Payment</th>
                    <th scope="col" className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((o) => (
                    <tr key={o.id} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                      <td className="px-4 py-3 font-mono text-xs text-navy-700">
                        {o.orderNumber || o.id.slice(-8)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-navy-900">{o.storeName || "—"}</div>
                        <div className="font-mono text-xs text-navy-400">{o.storeId}</div>
                      </td>
                      <td className="px-4 py-3 text-navy-700">{o.customerName || "—"}</td>
                      <td className="px-4 py-3 text-navy-700">{o.customerPhone || "—"}</td>
                      <td className="px-4 py-3 text-navy-600">{dt(o.orderDate)}</td>
                      <td className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-navy-500"
                        title={o.transactionId}>
                        {o.transactionId || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-navy-900">{inr(o.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-navy-700">{o.orderStatus || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        {o.paymentStatus ? <StatusBadge status={o.paymentStatus} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setOpenOrderId(o.id)}
                          className="font-semibold text-brand-600 hover:text-brand-700"
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {openOrderId && <OrderDrawer orderId={openOrderId} onClose={() => setOpenOrderId(null)} />}
    </div>
  );
};

export default SearchConsole;
