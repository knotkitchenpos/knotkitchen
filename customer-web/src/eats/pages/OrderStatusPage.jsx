import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Message from "../../components/Message";
import ReviewForm from "../components/ReviewForm";
import BottomNav from "../components/BottomNav";
import { FOCUS } from "../shared";
import { getEatsOrder } from "../api";
import { addRecentOrder } from "../../lib/eatsOrders";
import { totalPaid } from "../../lib/orderTotals";
import { thumbUrl } from "../../lib/thumbUrl";

const STEPS = ["placed", "accepted", "ready", "completed"];
// A delivery has one more stop: the restaurant has sent it out ("Out for delivery").
const DELIVERY_STEPS = ["placed", "accepted", "ready", "on_the_way", "completed"];
const POLL_MS = 15_000;
const BACKOFF_MS = 60_000;
const TERMINAL = new Set(["completed", "cancelled"]);
const STAGE_ICON = { placed: "🧾", accepted: "👨‍🍳", ready: "🛍️", on_the_way: "🛵", completed: "✅", cancelled: "✖️" };
const ACTION = `inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-3 text-[14px] font-semibold ${FOCUS}`;

const money = (n) => `₹${(Number(n) || 0).toFixed(2)}`;
const isDelivery = (order) => String(order?.orderType || "").toLowerCase() === "delivery";

function stageText(stage, delivery) {
  if (stage === "placed") return "Waiting for the restaurant to accept";
  if (stage === "accepted") return "Being prepared";
  if (stage === "ready") return delivery ? "Ready; the restaurant will send it out" : "Ready for pickup";
  if (stage === "on_the_way") return "On the way to you";
  if (stage === "completed") return delivery ? "Delivered" : "Picked up";
  if (stage === "cancelled") return "Cancelled by the restaurant";
  return "";
}

function stepLabel(step, delivery) {
  if (step === "placed") return "Placed";
  if (step === "accepted") return "Preparing";
  if (step === "ready") return "Ready";
  if (step === "on_the_way") return "On the way";
  return delivery ? "Delivered" : "Picked up";
}

function refundText(order) {
  if (order.refundStatus === "REFUNDED") return "Refunded to your original payment method";
  if (order.refundStatus === "REFUND_PENDING") return "Refund in progress";
  return order.stage === "cancelled" ? "Contact the restaurant about your refund" : "";
}

/**
 * /order/:token: a Knot Eats order's status, bill and review, reached from
 * checkout, Saved, or the e-bill's "Rate this order" link. The signed `v_`
 * token is the only key; there are no accounts.
 *
 * Polls every 15 s while the tab is visible until the order is completed or
 * cancelled; after an error it waits a minute before asking again.
 */
export default function OrderStatusPage() {
  const { token = "" } = useParams();
  const [params] = useSearchParams();
  const [data, setData] = useState(null);
  const [errorStatus, setErrorStatus] = useState(0);
  const [attempt, setAttempt] = useState(0); // Retry after an error

  useEffect(() => {
    let live = true;
    let timer = 0;
    const schedule = (ms) => {
      // A hidden tab does not poll; it checks again a little later. (The first
      // load always runs: a tab opened in the background still gets its order.)
      timer = window.setTimeout(() => (document.visibilityState === "hidden" ? schedule(POLL_MS) : load()), ms);
    };
    const load = () => {
      getEatsOrder(token)
        .then((res) => {
          if (!live) return;
          const d = res.data.data;
          setData(d);
          setErrorStatus(0);
          if (!TERMINAL.has(d.order?.stage)) schedule(POLL_MS);
        })
        .catch((err) => {
          if (!live) return;
          const status = err.response?.status || 0;
          setErrorStatus(status);
          if (status !== 404) schedule(BACKOFF_MS);
        });
    };
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [token, attempt]);

  const order = data?.order;
  useEffect(() => {
    document.title = order?.orderNumber ? `Order ${order.orderNumber} | Knot Eats` : "Your order | Knot Eats";
  }, [order?.orderNumber]);

  // Saved > Recent orders: an order opened here (from checkout, or the
  // e-bill link) is listed on this device, with the store's name filled in.
  useEffect(() => {
    if (!order?.orderNumber) return;
    addRecentOrder({ token, orderNumber: order.orderNumber, storeName: data.store?.name, storeId: data.store?.storeId, placedAt: order.placedAt });
  }, [token, order?.orderNumber, order?.placedAt, data?.store?.name, data?.store?.storeId]);

  // The e-bill's "Rate this order" link lands on #review.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!data || scrolled.current || window.location.hash !== "#review") return;
    scrolled.current = true;
    document.getElementById("review")?.scrollIntoView();
  }, [data]);

  const onSaved = useCallback(
    (review) => setData((d) => ({ ...d, review: { canReview: false, reason: "ALREADY_REVIEWED", existing: review } })),
    [],
  );

  if (!data && errorStatus === 404) {
    return (
      <Message icon="🔍" iconSize="text-5xl" title="Order not found">
        Check the link you followed.{" "}
        <Link to="/" className="font-semibold text-slate-800 underline underline-offset-2">
          Back to Knot Eats
        </Link>
      </Message>
    );
  }
  if (!data && errorStatus) {
    return (
      <Message icon="🕒" iconSize="text-5xl" title="Couldn't load your order">
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold text-slate-800 underline underline-offset-2">
          Retry
        </button>
      </Message>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8" aria-busy="true" aria-label="Loading your order">
        <div className="h-7 w-1/2 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-28 animate-pulse rounded-2xl bg-slate-200" />
        <div className="mt-4 h-40 animate-pulse rounded-2xl bg-slate-200" />
      </div>
    );
  }

  const { store = {}, review } = data;
  const delivery = isDelivery(order);
  const stage = order.stage;
  const steps = delivery ? DELIVERY_STEPS : STEPS;
  const current = steps.indexOf(stage);
  const refund = refundText(order);
  const phone = store.phone ? String(store.phone).replace(/[^\d+]/g, "") : "";
  const b = order.bills || {};
  const live = !TERMINAL.has(stage);
  const hero =
    stage === "cancelled" ? "from-red-600 to-red-700" : stage === "completed" ? "from-green-600 to-green-700" : "from-[color:var(--accent)] to-[color:var(--brand)]";
  const where = delivery
    ? [order.deliveryAddress?.line2, order.deliveryAddress?.line1].filter(Boolean).join(", ")
    : order.scheduledFor
      ? `Pickup at ${new Date(order.scheduledFor).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
      : "";
  const extras = (i) => [i.variant, ...(i.addons || []), ...(i.options || [])].filter(Boolean);

  return (
    <div className="min-h-screen bg-slate-50 pb-28 text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-2 py-1.5">
          <Link to="/orders" aria-label="Your orders" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 ${FOCUS}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-bold text-[color:var(--ke-ink)]">Order {order.orderNumber}</h1>
            <p className="truncate text-[12.5px] text-slate-500">
              {order.placedAt ? new Date(order.placedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-xl space-y-3 px-3 pt-3">
        {params.get("placed") === "1" ? (
          <p role="status" className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-[15px] font-semibold text-[color:var(--ke-good,#15803D)]">
            Payment received. Order placed.
          </p>
        ) : null}

        {/* Where the order is, at a glance */}
        <section className="overflow-hidden rounded-3xl bg-white shadow-[0_2px_12px_rgba(15,23,42,0.08)]" aria-label="Order status">
          <div className={`bg-gradient-to-br ${hero} px-5 py-5 text-white`}>
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-[30px]" aria-hidden="true">
                {STAGE_ICON[stage] || "🧾"}
              </span>
              <div className="min-w-0">
                <p className="text-[20px] font-extrabold leading-tight">{stageText(stage, delivery)}</p>
                {where ? <p className="mt-0.5 break-words text-[13.5px] text-white/90">{delivery ? `Delivering to ${where}` : where}</p> : null}
              </div>
            </div>
            {live ? (
              <p className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-white/90">
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                </span>
                Live: this page updates by itself
              </p>
            ) : null}
          </div>
          {stage !== "cancelled" ? (
            <ol className="px-5 py-4">
              {steps.map((s, i) => {
                const done = i < current || stage === "completed";
                const now = i === current && stage !== "completed";
                return (
                  <li key={s} aria-current={now ? "step" : undefined} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < steps.length - 1 ? (
                      <span className={`absolute left-[11px] top-6 h-[calc(100%-20px)] w-0.5 ${done ? "bg-[color:var(--ke-good,#15803D)]" : "bg-slate-200"}`} aria-hidden="true" />
                    ) : null}
                    <span
                      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                        done ? "bg-[color:var(--ke-good,#15803D)] text-white" : now ? "bg-brand text-white ring-4 ring-orange-100" : "border-2 border-slate-200 bg-white text-slate-400"
                      }`}
                      aria-hidden="true"
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={`pt-0.5 text-[14.5px] ${done || now ? "font-semibold text-slate-900" : "text-slate-400"}`}>
                      {stepLabel(s, delivery)}
                      {done ? <span className="sr-only"> (done)</span> : now ? <span className="sr-only"> (now)</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {refund ? <p className="border-t border-slate-100 px-5 py-3 text-[14px] text-slate-700">{refund}</p> : null}
        </section>

        {/* The restaurant, with its buttons on their own row so a long name is never cut. */}
        <section className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-label="Restaurant">
          <div className="flex items-center gap-3">
            {store.logo ? (
              <img src={thumbUrl(store.logo, 160)} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            ) : (
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[20px] font-extrabold text-brand" aria-hidden="true">
                {(store.name || "R").charAt(0)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <Link to={store.storeId ? `/store/${store.storeId}` : "/"} className={`block break-words rounded text-[16px] font-bold text-slate-900 ${FOCUS}`}>
                {store.name || "The restaurant"}
              </Link>
              <p className="text-[12.5px] text-slate-500">{delivery ? "Delivery" : "Pickup"} order</p>
            </div>
          </div>
          {phone || (!delivery && store.mapUrl) || (TERMINAL.has(stage) && store.storeId) ? (
            <div className="mt-3 flex gap-2">
              {phone ? (
                <a href={`tel:${phone}`} className={`${ACTION} border border-slate-300 text-slate-800`}>
                  Call
                </a>
              ) : null}
              {!delivery && store.mapUrl ? (
                <a href={store.mapUrl} target="_blank" rel="noreferrer" className={`${ACTION} border border-slate-300 text-slate-800`}>
                  Directions
                </a>
              ) : null}
              {TERMINAL.has(stage) && store.storeId ? (
                <Link to={`/store/${store.storeId}?reorder=${encodeURIComponent(token)}`} className={`${ACTION} bg-brand text-white`}>
                  Reorder
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-4 text-[14px] shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-labelledby="ke-bill">
          <h2 id="ke-bill" className="text-[13px] font-bold uppercase tracking-[0.12em] text-slate-500">
            Bill details
          </h2>
          <ul className="mt-2 space-y-2">
            {(order.items || []).map((i, idx) => (
              <li key={idx} className="flex justify-between gap-3">
                <span className="min-w-0 break-words text-slate-800">
                  <span className="font-semibold">{i.quantity} ×</span> {i.name}
                  {extras(i).length ? <span className="block text-[12px] text-slate-500">{extras(i).join(", ")}</span> : null}
                </span>
                <span className="shrink-0">{money(i.total)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 border-t border-dashed border-slate-200 pt-3 text-slate-600">
            <Line label="Item total" value={money(b.subtotal)} />
            {Number(b.discount) ? <Line label="Discount" value={`−${money(b.discount)}`} /> : null}
            {Number(b.packagingFee) ? <Line label="Packaging" value={money(b.packagingFee)} /> : null}
            {Number(b.tax) ? <Line label="Taxes" value={money(b.tax)} /> : null}
            {Number(b.deliveryFee) ? <Line label="Delivery fee" value={money(b.deliveryFee)} /> : null}
            {Number(b.platformFee) ? <Line label="Platform fee" value={money(b.platformFee)} /> : null}
            <div className="flex justify-between pt-1 text-[16px] font-bold text-slate-900">
              <span>Total paid</span>
              <span>{money(totalPaid(order))}</span>
            </div>
          </div>
        </section>

        <section id="review" className="scroll-mt-20 rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]" aria-label="Rate this order">
          <ReviewForm token={token} review={review} onSaved={onSaved} />
        </section>

        <p className="px-2 pb-2 text-center text-[12.5px] text-slate-500">
          A problem with this order? Call the restaurant first, or see{" "}
          <Link to="/legal/refunds" className="font-semibold underline underline-offset-2">
            Refunds &amp; cancellations
          </Link>
          .
        </p>
      </div>
      <BottomNav />
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
