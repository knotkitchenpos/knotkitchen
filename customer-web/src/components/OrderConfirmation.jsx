import React from "react";

/**
 * Shown after a successful order. The `order` payload comes directly from the
 * backend (`/api/storefront/:slug/orders`) and contains the AUTHORITATIVE
 * totals — never re-computed on the client.
 */
export default function OrderConfirmation({ order, symbol, prepTime, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oc-title"
    >
      <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6">
        <div className="text-center mb-4">
          <div className="text-5xl" aria-hidden="true">✅</div>
          <h2 id="oc-title" className="text-xl font-semibold mt-2">Order placed!</h2>
          <p className="text-sm text-slate-500 mt-1">
            Order <span className="font-mono">{order.orderNumber}</span>
          </p>
          {order.scheduledFor ? (
            <p className="text-sm font-semibold text-slate-800 mt-2">
              Pickup at{" "}
              {new Date(order.scheduledFor).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
            </p>
          ) : prepTime ? (
            <p className="text-xs text-slate-500 mt-1">Estimated preparation: ~{prepTime} min</p>
          ) : null}
          <p className="text-xs text-slate-500 mt-1">The restaurant will confirm your order shortly.</p>
        </div>

        <div className="border-t pt-3 space-y-1 text-sm">
          {order.items.map((i, idx) => (
            <div key={idx} className="flex justify-between">
              <span className="truncate pr-2">
                {i.quantity}× {i.name}
              </span>
              <span>
                {symbol}
                {Number(i.total).toFixed(2)}
              </span>
            </div>
          ))}
        </div>

        <div className="border-t mt-3 pt-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>
              {symbol}
              {Number(order.bills?.subtotal || 0).toFixed(2)}
            </span>
          </div>
          {order.bills?.tax ? (
            <div className="flex justify-between">
              <span>Tax</span>
              <span>
                {symbol}
                {Number(order.bills.tax).toFixed(2)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold text-slate-900 pt-1">
            <span>Total paid</span>
            <span>
              {symbol}
              {Number(order.bills?.totalWithTax || 0).toFixed(2)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full bg-brand text-brand-fg font-semibold rounded-full py-3"
        >
          Close
        </button>
      </div>
    </div>
  );
}
