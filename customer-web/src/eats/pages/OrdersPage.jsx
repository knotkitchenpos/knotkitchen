import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEatsOrder } from "../api";
import { recentOrders } from "../../lib/eatsOrders";
import { totalPaid } from "../../lib/orderTotals";
import EmptyState from "../components/EmptyState";
import BottomNav from "../components/BottomNav";
import { BTN_PRIMARY, FOCUS, useTitle } from "../shared";

const LIVE = new Set(["placed", "accepted", "ready", "on_the_way"]);
const STAGE = {
  placed: ["Waiting for the restaurant", "bg-amber-50 text-amber-800"],
  accepted: ["Being prepared", "bg-amber-50 text-amber-800"],
  ready: ["Ready", "bg-sky-50 text-sky-800"],
  on_the_way: ["On the way", "bg-sky-50 text-sky-800"],
  completed: ["Completed", "bg-green-50 text-green-800"],
  cancelled: ["Cancelled", "bg-red-50 text-red-700"],
};

/**
 * /orders: the orders placed on this device (Knot Eats has no accounts; each
 * order's signed link is kept by lib/eatsOrders). Each card asks the server
 * for its current status and bill, then offers Track, Reorder and Rate.
 */
export default function OrdersPage() {
  useTitle("Your orders");
  const [list] = useState(recentOrders);
  const [details, setDetails] = useState({}); // token -> { order, store, review } | "gone" | "error"

  useEffect(() => {
    let live = true;
    list.forEach((o) =>
      getEatsOrder(o.token)
        .then((res) => live && setDetails((d) => ({ ...d, [o.token]: res.data.data })))
        .catch((err) => live && setDetails((d) => ({ ...d, [o.token]: err.response?.status === 404 ? "gone" : "error" }))),
    );
    return () => {
      live = false;
    };
  }, [list]);

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <h1 className="text-[22px] font-extrabold text-[color:var(--ke-ink)]">Your orders</h1>
          <p className="text-[13px] text-slate-500">Orders placed on this device</p>
        </div>
      </header>
      <div className="mx-auto max-w-3xl space-y-3 px-3 pt-3">
        {list.length === 0 ? (
          <EmptyState
            title="No orders yet"
            actions={
              <Link to="/" className={BTN_PRIMARY}>
                Find restaurants
              </Link>
            }
          >
            Orders you place on Knot Eats from this phone or computer show up here.
          </EmptyState>
        ) : (
          list.map((o) => <OrderCard key={o.token} entry={o} detail={details[o.token]} />)
        )}
      </div>
      <BottomNav />
    </div>
  );
}

function OrderCard({ entry, detail }) {
  const loaded = detail && typeof detail === "object";
  const order = loaded ? detail.order : null;
  const store = loaded ? detail.store : null;
  const stage = order?.stage || "";
  const [label, tone] = STAGE[stage] || ["", ""];
  const items = (order?.items || []).map((i) => `${i.quantity} × ${i.name}`).join(", ");
  const storeId = store?.storeId || entry.storeId;
  const when = order?.placedAt || entry.placedAt;
  return (
    <article className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[16px] font-extrabold text-[color:var(--ke-ink)]">{store?.name || entry.storeName || "Restaurant"}</h2>
          <p className="text-[12.5px] text-slate-500">
            {entry.orderNumber || order?.orderNumber ? `Order ${order?.orderNumber || entry.orderNumber} · ` : ""}
            {when ? new Date(when).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}
          </p>
        </div>
        {label ? <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${tone}`}>{label}</span> : null}
      </div>
      {detail === undefined ? (
        <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-slate-200" aria-label="Loading" />
      ) : detail === "gone" ? (
        <p className="mt-2 text-[13px] text-slate-500">This order is no longer available.</p>
      ) : detail === "error" ? (
        <p className="mt-2 text-[13px] text-slate-500">Couldn&apos;t load this order right now.</p>
      ) : (
        <>
          {items ? <p className="mt-2 line-clamp-2 text-[14px] text-slate-700">{items}</p> : null}
          <p className="mt-1 text-[14px] font-bold text-slate-900">₹{totalPaid(order).toFixed(2)}</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Link to={`/order/${entry.token}`} className={`inline-flex min-h-[40px] items-center rounded-xl border border-slate-300 px-3.5 text-[14px] font-semibold text-slate-800 ${FOCUS}`}>
          {LIVE.has(stage) ? "Track order" : "View details"}
        </Link>
        {storeId && loaded && !LIVE.has(stage) ? (
          <Link to={`/store/${storeId}?reorder=${encodeURIComponent(entry.token)}`} className={`inline-flex min-h-[40px] items-center rounded-xl bg-brand px-3.5 text-[14px] font-semibold text-white ${FOCUS}`}>
            Reorder
          </Link>
        ) : null}
        {loaded && detail.review?.canReview ? (
          <Link to={`/order/${entry.token}#review`} className={`inline-flex min-h-[40px] items-center rounded-xl border border-brand px-3.5 text-[14px] font-semibold text-brand ${FOCUS}`}>
            Rate
          </Link>
        ) : null}
      </div>
    </article>
  );
}
