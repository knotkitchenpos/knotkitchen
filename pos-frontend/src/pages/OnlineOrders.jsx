import React, { useState } from "react";
import { useSelector } from "react-redux";
import { useOnlineOrders } from "../hooks/useOnlineOrders";
import { updateOnlineOrderStatus } from "../https/storefrontApi";
import { isAwaitingAcceptance, statusLabel } from "../constants/orderStatus";
import { orderDisplayId } from "../utils/orderLabels";
import { money } from "../utils";

/**
 * POS → Online Orders (§14).
 *
 * Shows website orders as they arrive in realtime and drives them through the
 * EXISTING POS order lifecycle (Pending → In Progress → Ready → Completed),
 * rather than introducing a parallel status system.
 */

const STATUS_STYLES = {
  Pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "In Progress": "bg-blue-500/15 text-blue-400 border-blue-500/30",
  // "Preparing" is the canonical name for the same kitchen state. Orders
  // created before the acceptance step existed carry it, and without a style
  // of its own they fell through to the grey "Completed" look.
  Preparing: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  Served: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  Delivered: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  Ready: "bg-green-500/15 text-green-400 border-green-500/30",
  Completed: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  Cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

// Which actions make sense from each status.
const NEXT_ACTIONS = {
  Pending: [
    { action: "accept", label: "Accept", style: "bg-green-600 hover:bg-green-500" },
    { action: "reject", label: "Reject", style: "bg-red-600 hover:bg-red-500" },
  ],
  "In Progress": [
    { action: "ready", label: "Mark Ready", style: "bg-blue-600 hover:bg-blue-500" },
    { action: "cancel", label: "Cancel", style: "bg-slate-600 hover:bg-slate-500" },
  ],
  // Same state, canonical spelling — an older order sitting in "Preparing"
  // must still be actionable rather than stranded with no buttons.
  Preparing: [
    { action: "ready", label: "Mark Ready", style: "bg-blue-600 hover:bg-blue-500" },
    { action: "cancel", label: "Cancel", style: "bg-slate-600 hover:bg-slate-500" },
  ],
  Ready: [{ action: "completed", label: "Complete", style: "bg-green-600 hover:bg-green-500" }],
};


const OrderCard = ({ order, onAction, busy }) => {
  const actions = NEXT_ACTIONS[order.orderStatus] || [];
  const isNew = isAwaitingAcceptance(order.orderStatus);

  return (
    <article
      className={`rounded-2xl border bg-[#0D1526] overflow-hidden ${
        isNew ? "border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,.15)]" : "border-[#26344B]"
      }`}
    >
      {isNew ? (
        <div className="bg-amber-500 text-slate-900 text-xs font-bold px-4 py-1.5 tracking-wide">
          NEW ONLINE ORDER
        </div>
      ) : null}

      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="font-bold text-[#F5F7FA]">
              {orderDisplayId(order)}
            </p>
            <p className="text-xs text-[#77839A]">
              {new Date(order.createdAt).toLocaleString()} ·{" "}
              <span className="uppercase font-semibold text-accent">{order.orderType}</span>
            </p>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold border ${
              STATUS_STYLES[order.orderStatus] || STATUS_STYLES.Completed
            }`}
          >
            {statusLabel(order.orderStatus)}
          </span>
        </div>

        {/* Customer */}
        <div className="p-3 rounded-xl bg-[#111B2E] mb-3 text-sm">
          <p className="font-medium text-[#F5F7FA]">{order.customerDetails?.name}</p>
          <a
            href={`tel:${order.customerDetails?.phone}`}
            className="text-accent hover:underline text-xs"
          >
            📞 {order.customerDetails?.phone}
          </a>
          {order.deliveryAddress?.line1 ? (
            <p className="text-xs text-[#AEB8CA] mt-1">
              📍 {order.deliveryAddress.line1}
              {order.deliveryAddress.city ? `, ${order.deliveryAddress.city}` : ""}
              {order.deliveryAddress.postalCode ? ` ${order.deliveryAddress.postalCode}` : ""}
            </p>
          ) : null}
          {order.deliveryAddress?.instructions ? (
            <p className="text-xs italic text-[#77839A] mt-1">
              “{order.deliveryAddress.instructions}”
            </p>
          ) : null}
        </div>

        {/* Items */}
        <ul className="space-y-2 mb-3">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="text-[#F5F7FA]">
                  <span className="font-bold text-accent">{item.quantity}×</span> {item.name}
                </p>
                {item.variant ? (
                  <p className="text-xs text-[#77839A] pl-6">{item.variant}</p>
                ) : null}
                {item.options?.length ? (
                  <p className="text-xs text-[#77839A] pl-6">
                    {item.options.map((o) => o.name).join(", ")}
                  </p>
                ) : null}
                {item.addons?.length ? (
                  <p className="text-xs text-[#77839A] pl-6">
                    + {item.addons.map((a) => a.name).join(", ")}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="text-xs text-amber-400 pl-6 italic">⚠ {item.note}</p>
                ) : null}
              </div>
              <span className="text-[#AEB8CA] shrink-0">{money(item.total)}</span>
            </li>
          ))}
        </ul>

        {/* Bill */}
        <div className="p-3 rounded-xl bg-[#111B2E] text-sm space-y-1 mb-3">
          <div className="flex justify-between text-[#77839A]">
            <span>Subtotal</span>
            <span>{money(order.bills?.subtotal)}</span>
          </div>
          {order.bills?.packagingFee > 0 ? (
            <div className="flex justify-between text-[#77839A]">
              <span>Packaging</span>
              <span>{money(order.bills.packagingFee)}</span>
            </div>
          ) : null}
          {order.bills?.deliveryFee > 0 ? (
            <div className="flex justify-between text-[#77839A]">
              <span>Delivery</span>
              <span>{money(order.bills.deliveryFee)}</span>
            </div>
          ) : null}
          {order.bills?.tax > 0 ? (
            <div className="flex justify-between text-[#77839A]">
              <span>Tax</span>
              <span>{money(order.bills.tax)}</span>
            </div>
          ) : null}
          <div className="flex justify-between font-bold text-[#F5F7FA] pt-1 border-t border-[#26344B]">
            <span>Total</span>
            <span>{money(order.bills?.totalWithTax)}</span>
          </div>
          <p className="text-xs text-[#77839A] pt-1">
            Payment:{" "}
            <span
              className={order.paymentStatus === "paid" ? "text-green-400" : "text-amber-400"}
            >
              {order.paymentStatus === "paid" ? "Paid" : "Pay on collection/delivery"}
            </span>
          </p>
        </div>

        {/* Actions */}
        {actions.length ? (
          <div className="flex gap-2">
            {actions.map((a) => (
              <button
                key={a.action}
                type="button"
                disabled={busy}
                onClick={() => onAction(order._id, a.action)}
                className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-colors ${a.style}`}
              >
                {a.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
};

const OnlineOrders = () => {
  const { restaurantId } = useSelector((s) => s.user);
  const { orders, loading, connected, newOrderAlert, dismissAlert, refresh } =
    useOnlineOrders(restaurantId);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const handleAction = async (orderId, action) => {
    if (action === "reject" && !window.confirm("Reject this order?")) return;
    try {
      setBusyId(orderId);
      setError("");
      await updateOnlineOrderStatus(orderId, action);
      await refresh();
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't update this order.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <h1 className="text-2xl font-bold text-[#F5F7FA]">Online Orders</h1>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
            connected
              ? "bg-green-500/15 text-green-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
          title={connected ? "Realtime connected" : "Reconnecting — using periodic refresh"}
        >
          {connected ? "● Live" : "○ Reconnecting"}
        </span>
        <button
          type="button"
          onClick={() => refresh()}
          className="ml-auto px-4 py-2 rounded-xl bg-[#162238] text-sm font-semibold text-[#F5F7FA] hover:bg-[#1c2a44]"
        >
          ↻ Refresh
        </button>
      </div>

      {/* New order toast */}
      {newOrderAlert ? (
        <div
          role="alert"
          className="mb-4 p-4 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center gap-3"
        >
          <span className="text-2xl" aria-hidden="true">🔔</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-amber-400">New online order received!</p>
            <p className="text-sm text-[#AEB8CA]">
              {newOrderAlert.customer?.name} · {newOrderAlert.itemCount} item(s) ·{" "}
              {money(newOrderAlert.bills?.totalWithTax)}
            </p>
          </div>
          <button
            type="button"
            onClick={dismissAlert}
            className="px-3 py-1.5 rounded-lg bg-[#162238] text-sm text-[#AEB8CA]"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-72 rounded-2xl bg-[#111B2E] animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-3" aria-hidden="true">🌐</div>
          <p className="font-semibold text-[#F5F7FA]">No active online orders</p>
          <p className="text-sm text-[#77839A] mt-1">
            New website orders will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 items-start">
          {orders.map((order) => (
            <OrderCard
              key={order._id}
              order={order}
              busy={busyId === order._id}
              onAction={handleAction}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default OnlineOrders;
