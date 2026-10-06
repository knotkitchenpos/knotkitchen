import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Message from "../../components/Message";
import ReviewForm from "../components/ReviewForm";
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

  return (
    <div className="mx-auto max-w-xl px-4 pb-16 pt-4 text-slate-800">
      <Link to="/" className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-brand">
        ← Knot Eats
      </Link>

      {params.get("placed") === "1" ? (
        <p role="status" className="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-[15px] font-semibold text-[color:var(--ke-good,#15803D)]">
          Payment received. Order placed.
        </p>
      ) : null}

      <h1 className="text-[24px] font-bold text-slate-900">Order {order.orderNumber}</h1>
      <p className="text-[13px] text-slate-500">
        {order.placedAt ? new Date(order.placedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
        {order.scheduledFor
          ? ` · Pickup at ${new Date(order.scheduledFor).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`
          : ""}
      </p>

      <section className="mt-4 rounded-2xl border border-slate-200 p-4" aria-label="Order status">
        <p className={`text-[18px] font-semibold ${stage === "cancelled" ? "text-[color:var(--ke-bad,#B91C1C)]" : "text-slate-900"}`}>
          {stageText(stage, delivery)}
        </p>
        {stage !== "cancelled" ? (
          <ol className={`mt-3 grid ${delivery ? "grid-cols-5" : "grid-cols-4"} gap-1 text-center text-[12px]`}>
            {steps.map((s, i) => (
              <li key={s} aria-current={i === current ? "step" : undefined} className={i <= current ? "font-semibold text-slate-900" : "text-slate-400"}>
                <span className={`mb-1 block h-1.5 rounded-full ${i <= current ? "bg-[color:var(--ke-good,#15803D)]" : "bg-slate-200"}`} />
                {stepLabel(s, delivery)}
              </li>
            ))}
          </ol>
        ) : null}
        {refund ? <p className="mt-2 text-[14px] text-slate-700">{refund}</p> : null}
        {delivery && (order.deliveryAddress?.line1 || order.deliveryAddress?.line2) ? (
          <p className="mt-2 text-[14px] text-slate-600">
            Delivering to {[order.deliveryAddress.line1, order.deliveryAddress.line2].filter(Boolean).join(", ")}
          </p>
        ) : null}
      </section>

      <section className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 p-4" aria-label="Restaurant">
        {store.logo ? <img src={thumbUrl(store.logo, 160)} alt="" className="h-11 w-11 rounded-full object-cover" /> : null}
        <Link to={store.storeId ? `/store/${store.storeId}` : "/"} className="min-w-0 flex-1 truncate font-semibold text-slate-900">
          {store.name || "The restaurant"}
        </Link>
        {phone ? (
          <a href={`tel:${phone}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-3 text-[14px] font-medium">
            Call
          </a>
        ) : null}
        {!delivery && store.mapUrl ? (
          <a href={store.mapUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-300 px-3 text-[14px] font-medium">
            Directions
          </a>
        ) : null}
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 p-4 text-[14px]" aria-labelledby="ke-bill">
        <h2 id="ke-bill" className="text-[16px] font-semibold text-slate-900">
          Bill
        </h2>
        <ul className="mt-2 space-y-1">
          {(order.items || []).map((i, idx) => (
            <li key={idx} className="flex justify-between gap-3">
              <span className="min-w-0 break-words">
                {i.quantity}× {i.name}
                {[i.variant, ...(i.addons || []), ...(i.options || [])].filter(Boolean).length ? (
                  <span className="block text-[12px] text-slate-500">{[i.variant, ...(i.addons || []), ...(i.options || [])].filter(Boolean).join(", ")}</span>
                ) : null}
              </span>
              <span className="shrink-0">{money(i.total)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t pt-3 text-slate-600">
          <Line label="Subtotal" value={money(b.subtotal)} />
          {Number(b.discount) ? <Line label="Discount" value={`−${money(b.discount)}`} /> : null}
          {Number(b.packagingFee) ? <Line label="Packaging" value={money(b.packagingFee)} /> : null}
          {Number(b.tax) ? <Line label="Tax" value={money(b.tax)} /> : null}
          {Number(b.deliveryFee) ? <Line label="Delivery" value={money(b.deliveryFee)} /> : null}
          {Number(b.platformFee) ? <Line label="Platform fee" value={money(b.platformFee)} /> : null}
          <div className="flex justify-between pt-1 text-[15px] font-semibold text-slate-900">
            <span>Total paid</span>
            <span>{money(totalPaid(order))}</span>
          </div>
        </div>
      </section>

      <section id="review" className="mt-4 scroll-mt-4 rounded-2xl border border-slate-200 p-4" aria-label="Rate this order">
        <ReviewForm token={token} review={review} onSaved={onSaved} />
      </section>
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
