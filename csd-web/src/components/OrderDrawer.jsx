import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiX, FiExternalLink } from "react-icons/fi";
import { orders, errorMessage } from "../api";
import StatusBadge from "./StatusBadge";
import { inr, dt } from "../lib/format";


const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 border-b border-navy-100 py-2 last:border-b-0">
    <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
    <dd className="text-right text-sm text-navy-900">{children ?? "—"}</dd>
  </div>
);

/** Slide-over showing one order in full. */
const OrderDrawer = ({ orderId, onClose }) => {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setOrder(null);
    setError("");
    orders
      .get(orderId)
      .then((d) => alive && setOrder(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load this order.")));
    return () => {
      alive = false;
    };
  }, [orderId]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Order details"
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl"
      >
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-navy-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-bold text-navy-900">Order details</h2>
            {order && (
              <p className="font-mono text-xs text-navy-500">
                {order.orderNumber || order.id}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-800" aria-label="Close">
            <FiX size={20} />
          </button>
        </header>

        <div className="p-5">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!order && !error && <p className="text-sm text-navy-500">Loading…</p>}

          {order && (
            <div className="space-y-6">
              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Summary</h3>
                <dl>
                  <Row label="Store">
                    {order.storeId ? (
                      <Link to={`/stores/${order.storeId}`} onClick={onClose}
                        className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                        {order.storeName || order.storeId} <FiExternalLink size={12} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </Row>
                  <Row label="Placed">{dt(order.orderDate)}</Row>
                  <Row label="Order status">{order.orderStatus || "—"}</Row>
                  <Row label="Payment">
                    {order.paymentStatus ? <StatusBadge status={order.paymentStatus} /> : "—"}
                  </Row>
                  <Row label="Type">{order.orderType || "—"}</Row>
                  <Row label="Source">{order.source || "—"}</Row>
                  <Row label="Transaction ID">
                    <span className="font-mono text-xs">{order.transactionId || "—"}</span>
                  </Row>
                </dl>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Customer</h3>
                <dl>
                  <Row label="Name">{order.customer.name || "—"}</Row>
                  <Row label="Phone">{order.customer.phone || "—"}</Row>
                  <Row label="Address">{order.customer.address || "—"}</Row>
                  {order.customer.note && <Row label="Note">{order.customer.note}</Row>}
                </dl>
              </section>

              {order.items.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Items</h3>
                  <ul className="divide-y divide-navy-100">
                    {order.items.map((it, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 py-2">
                        <span className="text-sm text-navy-800">
                          <span className="font-medium">{it.quantity}×</span> {it.name}
                        </span>
                        <span className="shrink-0 text-sm text-navy-700">{inr(it.total || it.price)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Bill</h3>
                <dl>
                  <Row label="Subtotal">{inr(order.bills.subtotal)}</Row>
                  {!!order.bills.discount && <Row label="Discount">−{inr(order.bills.discount)}</Row>}
                  {!!order.bills.deliveryFee && <Row label="Delivery">{inr(order.bills.deliveryFee)}</Row>}
                  {!!order.bills.packagingFee && <Row label="Packaging">{inr(order.bills.packagingFee)}</Row>}
                  <Row label="Tax">{inr(order.bills.tax)}</Row>
                  <Row label="Total">
                    <span className="text-base font-bold">
                      {inr(order.bills.totalWithTax ?? order.bills.total)}
                    </span>
                  </Row>
                </dl>
              </section>

              {order.payments.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Payments</h3>
                  <ul className="space-y-2">
                    {order.payments.map((p, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-navy-200 p-3">
                        <span className="text-sm capitalize text-navy-800">{p.method}</span>
                        <span className="flex items-center gap-3">
                          <StatusBadge status={p.status} />
                          <span className="text-sm font-semibold text-navy-900">{inr(p.amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {order.timeline.length > 0 && (
                <section>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Timeline</h3>
                  <ul className="space-y-1.5">
                    {order.timeline.map((t, i) => (
                      <li key={i} className="flex justify-between gap-3 text-xs">
                        <span className="text-navy-700">{t.status}</span>
                        <span className="text-navy-400">{dt(t.timestamp)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
};

export default OrderDrawer;
