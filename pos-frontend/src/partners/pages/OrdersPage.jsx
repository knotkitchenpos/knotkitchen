import React, { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MdClose, MdSearch } from "react-icons/md";
import { partnersApi, errorMessage } from "../api";
import { inr, dateGB, time12 } from "../../utils";
import { statusLabel, isCancelled } from "../../constants/orderStatus";
import { sourceLabel, tableLabel } from "../../utils/orderLabels";
import { formatQty, resolveItemAmounts } from "../../utils/orderItems";
import { PeriodPicker, StoreFilter, rangeFor } from "../components/Filters";

const typeLabel = (t) => ({ delivery: "Delivery", collection: "Collection", takeaway: "Collection", "dine-in": "Dine-in", dinein: "Dine-in" }[String(t || "").toLowerCase()] || t || "—");

const OrderDetail = ({ row, onClose }) => {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-order", row.storeId, row._id],
    queryFn: () => partnersApi.order(row.storeId, row._id).then((r) => r.data.data),
  });
  const o = data;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Order details">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[460px] h-full bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] px-5 h-14 flex items-center justify-between">
          <p className="text-[15px] font-extrabold">Order #{row.orderNumber || row.orderId || String(row._id).slice(-6)}</p>
          <button type="button" onClick={onClose} className="w-9 h-9 rounded-full hover:bg-[#F1F5F9] flex items-center justify-center" aria-label="Close">
            <MdClose size={20} />
          </button>
        </div>
        <div className="p-5 space-y-4 text-[13px]">
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-[#94A3B8] font-bold">Store</dt><dd className="font-bold">{row.storeName}</dd></div>
            {row.billNumber && <div><dt className="text-[#94A3B8] font-bold">Bill No.</dt><dd className="font-bold">{row.billNumber}</dd></div>}
            <div><dt className="text-[#94A3B8] font-bold">Placed</dt><dd className="font-bold">{dateGB(row.createdAt)}, {time12(row.createdAt)}</dd></div>
            <div><dt className="text-[#94A3B8] font-bold">Type</dt><dd className="font-bold">{tableLabel(row.table) || typeLabel(row.orderType)}</dd></div>
            <div><dt className="text-[#94A3B8] font-bold">Status</dt><dd className="font-bold">{statusLabel(row.orderStatus)}</dd></div>
            <div><dt className="text-[#94A3B8] font-bold">Channel</dt><dd className="font-bold">{sourceLabel(row.source, row.salesChannel)}</dd></div>
            <div><dt className="text-[#94A3B8] font-bold">Payment</dt><dd className="font-bold">{row.paymentMethod || "—"}</dd></div>
            {row.customerName && <div className="col-span-2"><dt className="text-[#94A3B8] font-bold">Customer</dt><dd className="font-bold">{row.customerName}{row.customerPhone ? ` · ${row.customerPhone}` : ""}</dd></div>}
          </dl>
          {isLoading ? (
            <p className="text-[#94A3B8]">Loading items…</p>
          ) : isError ? (
            <p className="text-[#B91C1C] font-bold">{errorMessage(error, "Could not load the order.")}</p>
          ) : (
            <>
              <ul className="divide-y divide-[#F1F5F9] border-y border-[#F1F5F9]">
                {(o?.items || []).map((it, i) => {
                  const a = resolveItemAmounts(it);
                  return (
                    <li key={i} className="py-2.5 flex gap-3">
                      <span className="font-extrabold text-[#64748B] w-10 shrink-0">{formatQty(a.quantity)}×</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{it.name}</span>
                        {(it.modifiers || []).length > 0 && <span className="block text-[12px] text-[#64748B]">{it.modifiers.map((m) => m.name).join(", ")}</span>}
                        {it.status === "Cancelled" && <span className="text-[11.5px] font-bold text-[#B91C1C]">Cancelled</span>}
                      </span>
                      <span className="font-bold shrink-0">{inr(a.lineTotal)}</span>
                    </li>
                  );
                })}
              </ul>
              <dl className="space-y-1.5">
                {o?.bills?.subtotal != null && <div className="flex justify-between"><dt className="text-[#64748B]">Subtotal</dt><dd className="font-bold">{inr(o.bills.subtotal)}</dd></div>}
                {Number(o?.bills?.discount) > 0 && <div className="flex justify-between"><dt className="text-[#64748B]">Discount</dt><dd className="font-bold">−{inr(o.bills.discount)}</dd></div>}
                {Number(o?.bills?.tax) > 0 && <div className="flex justify-between"><dt className="text-[#64748B]">Tax</dt><dd className="font-bold">{inr(o.bills.tax)}</dd></div>}
                <div className="flex justify-between text-[15px] pt-1.5 border-t border-[#F1F5F9]"><dt className="font-extrabold">Total</dt><dd className="font-extrabold">{inr(o?.bills?.totalWithTax ?? row.total)}</dd></div>
              </dl>
            </>
          )}
          <p className="text-[11.5px] text-[#94A3B8]">Read only. Changes to an order are made in that store&apos;s POS.</p>
        </div>
      </div>
    </div>
  );
};

const OrdersPage = ({ me }) => {
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState({});
  const [stores, setStores] = useState([]);
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [open, setOpen] = useState(null);
  const range = rangeFor(period, custom);
  const params = { ...range, ...(stores.length ? { stores: stores.join(",") } : {}), ...(query ? { q: query } : {}) };
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["partner-orders", params],
    queryFn: () => partnersApi.orders(params).then((r) => r.data.data),
    placeholderData: (prev) => prev,
  });
  const orders = data?.orders || [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Orders</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Every order across your stores. Read only.</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        <StoreFilter stores={me?.stores || []} selected={stores} onChange={setStores} />
      </div>
      <label className="relative block max-w-[480px]">
        <MdSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" size={20} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search order or bill number, customer, phone or store"
          className="w-full h-11 pl-11 pr-3 rounded-xl border border-[#E2E8F0] bg-white text-[14px] focus:border-[#FD5302] focus:outline-none"
        />
      </label>

      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load the orders.")}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : orders.length === 0 ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-10 text-center text-[14px] text-[#94A3B8]">No orders in this period.</div>
      ) : (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <p className="px-4 py-3 text-[12.5px] font-bold text-[#64748B] border-b border-[#F1F5F9]">
            {data.total.toLocaleString("en-IN")} order{data.total === 1 ? "" : "s"}
            {data.truncated ? " · showing the newest 1,000" : ""}
            {isFetching ? " · updating…" : ""}
          </p>
          {/* Phone: cards. Wider: a table. */}
          <ul className="xl:hidden divide-y divide-[#F1F5F9]">
            {orders.map((o) => (
              <li key={`${o.storeId}-${o._id}`}>
                <button type="button" onClick={() => setOpen(o)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-[#F8FAFC]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-extrabold truncate">#{o.orderNumber || String(o._id).slice(-6)} · {o.storeName}</span>
                    <span className="block text-[12px] text-[#64748B] truncate">
                      {time12(o.createdAt)} · {tableLabel(o.table) || typeLabel(o.orderType)} · {statusLabel(o.orderStatus)}
                    </span>
                  </span>
                  <span className={`text-[14px] font-extrabold shrink-0 ${isCancelled(o.orderStatus) ? "line-through text-[#94A3B8]" : ""}`}>{inr(o.total)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden xl:block overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-wide text-[#64748B] bg-[#F8FAFC]">
                  <th className="py-2.5 px-4 font-bold">Order</th>
                  <th className="py-2.5 px-3 font-bold">Bill No.</th>
                  <th className="py-2.5 px-3 font-bold">Store</th>
                  <th className="py-2.5 px-3 font-bold">Time</th>
                  <th className="py-2.5 px-3 font-bold">Type</th>
                  <th className="py-2.5 px-3 font-bold">Channel</th>
                  <th className="py-2.5 px-3 font-bold">Status</th>
                  <th className="py-2.5 px-3 font-bold">Customer</th>
                  <th className="py-2.5 px-4 font-bold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1F5F9]">
                {orders.map((o) => (
                  <tr key={`${o.storeId}-${o._id}`} onClick={() => setOpen(o)} className="cursor-pointer hover:bg-[#FFF7F2]">
                    <td className="py-2.5 px-4 font-extrabold">#{o.orderNumber || String(o._id).slice(-6)}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{o.billNumber || "—"}</td>
                    <td className="py-2.5 px-3 font-bold max-w-[180px] truncate">{o.storeName}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{dateGB(o.createdAt)}, {time12(o.createdAt)}</td>
                    <td className="py-2.5 px-3">{tableLabel(o.table) || typeLabel(o.orderType)}</td>
                    <td className="py-2.5 px-3">{sourceLabel(o.source, o.salesChannel)}</td>
                    <td className="py-2.5 px-3">{statusLabel(o.orderStatus)}</td>
                    <td className="py-2.5 px-3 max-w-[160px] truncate">{o.customerName || "—"}</td>
                    <td className={`py-2.5 px-4 text-right font-extrabold ${isCancelled(o.orderStatus) ? "line-through text-[#94A3B8]" : ""}`}>{inr(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {open && <OrderDetail row={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default OrdersPage;
