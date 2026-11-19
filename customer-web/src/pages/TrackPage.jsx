import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Message from "../components/Message";
import { getTrackedOrder } from "../lib/api";
import { riderText } from "../lib/riderText";
import DeliveryCode from "../components/DeliveryCode";

/**
 * /track/:token on a store's website: a delivery order's live status and the
 * restaurant's rider. The signed t_ link (from the order confirmation) is the
 * only key, and it shows no customer details. Polls every 15 seconds while
 * the tab is visible, until the order is delivered or cancelled.
 */
const STEPS = ["placed", "accepted", "ready", "on_the_way", "completed"];
const LABEL = { placed: "Placed", accepted: "Preparing", ready: "Ready", on_the_way: "On the way", completed: "Delivered" };
const HEADLINE = {
  placed: "Waiting for the restaurant to accept",
  accepted: "Your order is being prepared",
  ready: "Ready; the rider will pick it up",
  on_the_way: "On the way to you",
  completed: "Delivered. Enjoy your meal!",
  cancelled: "This order was cancelled",
};
const ICON = { placed: "🧾", accepted: "👨‍🍳", ready: "🛍️", on_the_way: "🛵", completed: "✅", cancelled: "✖️" };
const POLL_MS = 15_000;

export default function TrackPage() {
  const { token = "" } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(0);

  useEffect(() => {
    let live = true;
    let timer = 0;
    const load = () => {
      if (document.visibilityState === "hidden") {
        timer = window.setTimeout(load, POLL_MS);
        return;
      }
      getTrackedOrder(token)
        .then((res) => {
          if (!live) return;
          const d = res.data.data;
          setData(d);
          setError(0);
          if (!["completed", "cancelled"].includes(d.order.stage)) timer = window.setTimeout(load, POLL_MS);
        })
        .catch((err) => {
          if (!live) return;
          const status = err.response?.status || 1;
          setError(status);
          if (status !== 404) timer = window.setTimeout(load, 60_000);
        });
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    if (data?.order?.orderNumber) document.title = `Order ${data.order.orderNumber}${data.store?.name ? ` | ${data.store.name}` : ""}`;
  }, [data]);

  if (!data && error === 404) {
    return (
      <Message icon="🔍" title="Order not found">
        Check the link you followed.
      </Message>
    );
  }
  if (!data && error) {
    return (
      <Message icon="🕒" title="Couldn't load your order">
        We&apos;ll try again in a minute.
      </Message>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-md px-4 py-8" aria-busy="true" aria-label="Loading your order">
        <div className="h-7 w-1/2 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-40 animate-pulse rounded-3xl bg-slate-200" />
      </div>
    );
  }

  const { order, store } = data;
  const stage = order.stage;
  const current = STEPS.indexOf(stage);
  const rider = riderText(order.rider);
  const phone = store.phone ? String(store.phone).replace(/[^\d+]/g, "") : "";
  const live = !["completed", "cancelled"].includes(stage);

  return (
    <main className="min-h-screen bg-slate-50 px-3 pb-10 pt-4 text-slate-800">
      <div className="mx-auto max-w-md space-y-3">
        <header className="flex items-center gap-3 px-1">
          {store.logo ? <img src={store.logo} alt="" className="h-11 w-11 rounded-xl object-cover" /> : null}
          <div className="min-w-0">
            <p className="truncate text-[17px] font-bold text-slate-900">{store.name || "Your order"}</p>
            <p className="text-[13px] text-slate-500">Order {order.orderNumber}</p>
          </div>
        </header>

        <section className="overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.08)]" aria-live="polite">
          <div className={`px-5 py-5 text-white ${stage === "cancelled" ? "bg-red-600" : stage === "completed" ? "bg-green-600" : "bg-[#FD5302]"}`}>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-[30px]" aria-hidden="true">
                {ICON[stage] || "🧾"}
              </span>
              <p className="text-[20px] font-extrabold leading-tight">{order.rider?.stage === "arrived" && stage !== "completed"
                  ? "Your rider is at your door"
                  : stage === "ready" && !order.rider
                    ? "Ready; the restaurant will send it out"
                    : HEADLINE[stage] || ""}</p>
            </div>
            {rider ? (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-[13.5px] font-bold">
                <span aria-hidden="true">🛵</span>
                {rider}
              </p>
            ) : null}
            {live ? <p className="mt-3 text-[12.5px] font-semibold text-white/90">Live: this page updates by itself</p> : null}
          </div>
          {stage !== "cancelled" ? (
            <ol className="grid grid-cols-5 gap-1 px-4 py-4">
              {STEPS.map((s, i) => {
                const done = i <= current;
                return (
                  <li key={s} className="text-center" aria-current={i === current ? "step" : undefined}>
                    <span className={`block h-1.5 rounded-full ${done ? "bg-green-600" : "bg-slate-200"}`} />
                    <span className={`mt-1.5 block text-[11px] font-bold ${done ? "text-slate-900" : "text-slate-400"}`}>{LABEL[s]}</span>
                  </li>
                );
              })}
            </ol>
          ) : order.refundStatus === "REFUNDED" ? (
            <p className="px-5 py-4 text-[14px] text-slate-600">Refunded to your original payment method.</p>
          ) : (
            <p className="px-5 py-4 text-[14px] text-slate-600">Contact the restaurant about your refund.</p>
          )}
        </section>

        <DeliveryCode code={order.deliveryCode} />

        <section className="rounded-3xl bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-500">Your order</h2>
          <ul className="mt-2 space-y-1 text-[14.5px]">
            {order.items.map((i, n) => (
              <li key={n} className="flex gap-2">
                <span className="font-semibold">{i.quantity}×</span>
                <span className="min-w-0 break-words">{i.name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-slate-100 pt-3 text-[15px] font-bold">
            <span>Total paid</span>
            <span>₹{Number(order.totalPaid || 0).toFixed(2)}</span>
          </p>
        </section>

        {phone ? (
          <a href={`tel:${phone}`} className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border-2 border-slate-300 bg-white font-semibold text-slate-800">
            📞 Call the restaurant
          </a>
        ) : null}
      </div>
    </main>
  );
}
