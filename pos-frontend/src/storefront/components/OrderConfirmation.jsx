import React, { useEffect } from "react";
import { formatPrice } from "../theme";

/**
 * Order confirmation (§11).
 *
 * Renders the SERVER's authoritative response — order number, validated line
 * items and the final bill the backend computed — so the customer always sees
 * exactly what the restaurant received.
 */
const OrderConfirmation = ({ order, currencySymbol = "₹", prepTime, onClose }) => {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!order) return null;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Order confirmed"
    >
      <div className="w-full max-w-md max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Success header */}
        <div className="shrink-0 p-6 text-center bg-green-50 border-b border-green-100">
          <div
            className="w-16 h-16 mx-auto mb-3 rounded-full bg-green-500 flex items-center justify-center text-white text-3xl"
            aria-hidden="true"
          >
            ✓
          </div>
          <h2 className="text-xl font-bold text-slate-900">Order Confirmed!</h2>
          <p className="text-sm text-slate-600 mt-1">
            Order <strong>{order.orderNumber}</strong>
          </p>
          {prepTime ? (
            <p className="text-xs text-slate-500 mt-2">
              Estimated {order.orderType === "delivery" ? "delivery" : "pickup"} in ~{prepTime} minutes
            </p>
          ) : null}
        </div>

        {/* Items + bill */}
        <div className="flex-1 overflow-y-auto p-5">
          <ul className="space-y-3 mb-5">
            {order.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">
                    {item.quantity} × {item.name}
                  </p>
                  {item.variant ? <p className="text-xs text-slate-500">{item.variant}</p> : null}
                  {item.options?.length ? (
                    <p className="text-xs text-slate-500">{item.options.join(", ")}</p>
                  ) : null}
                  {item.addons?.length ? (
                    <p className="text-xs text-slate-500">+ {item.addons.join(", ")}</p>
                  ) : null}
                  {item.note ? (
                    <p className="text-xs italic text-slate-400">“{item.note}”</p>
                  ) : null}
                </div>
                <span className="font-semibold text-slate-800 shrink-0">
                  {formatPrice(item.total, currencySymbol)}
                </span>
              </li>
            ))}
          </ul>

          <div className="p-4 rounded-2xl bg-slate-50 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatPrice(order.bills.subtotal, currencySymbol)}</span>
            </div>
            {order.bills.packagingFee > 0 ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Packaging</span>
                <span>{formatPrice(order.bills.packagingFee, currencySymbol)}</span>
              </div>
            ) : null}
            {order.bills.deliveryFee > 0 ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Delivery</span>
                <span>{formatPrice(order.bills.deliveryFee, currencySymbol)}</span>
              </div>
            ) : null}
            {order.bills.tax > 0 ? (
              <div className="flex justify-between">
                <span className="text-slate-500">Tax</span>
                <span>{formatPrice(order.bills.tax, currencySymbol)}</span>
              </div>
            ) : null}
            <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-base">
              <span>Total</span>
              <span>{formatPrice(order.bills.totalWithTax, currencySymbol)}</span>
            </div>
          </div>

          <p className="text-xs text-center text-slate-500 mt-4">
            We've sent your order to the restaurant. They'll confirm it shortly.
            {order.customer?.phone ? ` We may call you on ${order.customer.phone}.` : ""}
          </p>
        </div>

        <div className="shrink-0 p-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            Continue Browsing
          </button>
        </div>
      </div>
    </div>
  );
};

export default OrderConfirmation;
