import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { riderApi, errorMessage } from "../api";
import { rupees, clock, dayAndTime } from "../format";
import { DeliveryCard } from "../components/Delivery";
import { CardSkeleton, Empty, ErrorCard, Icon, StageBadge, TopBar } from "../components/ui";

/** Everything on the rider right now. */
export function Deliveries({ me }) {
  const q = useQuery({ queryKey: ["active"], queryFn: riderApi.active, refetchInterval: 60_000 });
  const list = q.data?.deliveries || [];
  return (
    <div className="px-4 pb-6">
      <TopBar title="Deliveries" />
      <div className="space-y-3">
        {q.isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : q.isError ? (
          <ErrorCard message={errorMessage(q.error, "Couldn't load your deliveries.")} onRetry={() => q.refetch()} />
        ) : list.length ? (
          list.map((d) => <DeliveryCard key={d.orderId} delivery={d} primary={d.stage === "assigned"} />)
        ) : (
          <div className="r-card">
            <Empty
              emoji={me.online ? "🎉" : "🛵"}
              title={me.online ? "No active deliveries" : "You're Offline"}
              body={me.online ? "" : "Go online to receive delivery requests."}
              action={<Link to="/history" className="r-btn r-btn-ghost">See history</Link>}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This Week"],
  ["month", "This Month"],
];

/** Finished deliveries, by day range, searchable by order number or customer. */
export function History() {
  const [range, setRange] = useState("today");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);
  const res = useQuery({ queryKey: ["history", range, q], queryFn: () => riderApi.history(range, q), placeholderData: (prev) => prev });
  const list = res.data?.deliveries || [];
  const sum = res.data?.summary;
  return (
    <div className="px-4 pb-6">
      <TopBar title="Delivery History" />
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="When">
        {RANGES.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={range === k}
            onClick={() => setRange(k)}
            className="r-focus min-h-[42px] shrink-0 rounded-full px-4 text-[14px] font-extrabold"
            style={{ background: range === k ? "var(--r-ink)" : "var(--r-card)", color: range === k ? "var(--r-bg)" : "var(--r-ink-2)", border: "1px solid var(--r-line)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative mb-3">
        <span className="r-faint pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <Icon.search s={18} />
        </span>
        <label htmlFor="r-hsearch" className="sr-only">
          Search by order number or customer
        </label>
        <input id="r-hsearch" className="r-input" style={{ paddingLeft: 44 }} placeholder="Order # or customer" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {sum ? (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <div className="r-card p-3">
            <p className="r-faint text-[12px] font-extrabold uppercase tracking-wider">Delivered</p>
            <p className="text-[22px] font-black">{sum.delivered}</p>
          </div>
          <div className="r-card p-3">
            <p className="r-faint text-[12px] font-extrabold uppercase tracking-wider">Order value</p>
            <p className="text-[22px] font-black">{rupees(sum.value)}</p>
          </div>
        </div>
      ) : null}
      <div className="space-y-2.5">
        {res.isLoading ? (
          <CardSkeleton rows={2} />
        ) : res.isError ? (
          <ErrorCard message={errorMessage(res.error, "Couldn't load your history.")} onRetry={() => res.refetch()} />
        ) : list.length ? (
          list.map((d) => (
            <Link key={d.orderId} to={`/delivery/${d.orderId}`} className="r-card r-focus flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[16px] font-black">Order #{d.orderNumber}</p>
                  <StageBadge stage={d.stage} />
                </div>
                <p className="r-muted mt-0.5 truncate text-[14px] font-semibold">
                  {d.customer.name} · {rupees(d.bills.total)}
                </p>
                <p className="r-faint text-[13px] font-semibold">
                  {d.stage === "delivered" ? `🟢 Delivered ${range === "today" ? clock(d.times.deliveredAt) : dayAndTime(d.times.deliveredAt)}` : `Cancelled ${dayAndTime(d.times.cancelledAt || d.times.assignedAt)}`}
                </p>
              </div>
              <Icon.chevron className="r-faint" />
            </Link>
          ))
        ) : (
          <div className="r-card">
            <Empty emoji="📋" title={q ? "No matches" : "Nothing here yet"}  />
          </div>
        )}
      </div>
    </div>
  );
}
