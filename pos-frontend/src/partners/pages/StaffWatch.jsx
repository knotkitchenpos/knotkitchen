import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MdFlag, MdWarningAmber } from "react-icons/md";
import { partnersApi, errorMessage } from "../api";
import { inr, dateGB, time12 } from "../../utils";
import { PeriodPicker, StoreFilter, rangeFor } from "../components/Filters";

/**
 * Staff watch (owner, 2026-11-13): who sold, discounted, cancelled and
 * refunded what, per store, and who stands out from their colleagues
 * (pos-backend services/staffWatch.js). A flag is a question to ask, not a
 * verdict: a manager handling every complaint cancels more than a cashier.
 */

const Rate = ({ value, warn }) => (
  <span className={`text-[11.5px] font-bold ${warn ? "text-[#B91C1C]" : "text-[#94A3B8]"}`}>{value}%</span>
);

const Person = ({ p, store }) => {
  const cancelled = p.cancelledOrders + p.cancelledLines;
  const cancelledAmount = p.cancelledAmount + p.cancelledLineAmount;
  return (
    <div className={`rounded-xl border p-3.5 ${p.flags.length ? "border-[#FECACA] bg-[#FFFBFB]" : "border-[#E2E8F0] bg-white"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-extrabold truncate">{p.name}</p>
          <p className="text-[12px] text-[#64748B]">
            {p.orders} order{p.orders === 1 ? "" : "s"} · {inr(p.sales)}
          </p>
        </div>
        {p.flags.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full bg-[#FEE2E2] text-[#991B1B] shrink-0">
            <MdFlag size={13} /> {p.flags.length}
          </span>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-[#94A3B8] font-bold">Discounts</dt>
          <dd className="font-extrabold">{p.discounts} · {inr(p.discountAmount)}</dd>
          <Rate value={p.discountRate} warn={p.discountRate >= 2 * Math.max(store.discountRate, 0.01) && p.discountRate >= 5} />
        </div>
        <div className="min-w-0">
          <dt className="text-[#94A3B8] font-bold">Cancelled</dt>
          <dd className="font-extrabold">{cancelled} · {inr(cancelledAmount)}</dd>
          <Rate value={p.cancelRate} warn={p.cancelRate >= 2 * Math.max(store.cancelRate, 0.01) && p.cancelRate >= 5} />
        </div>
        <div className="min-w-0">
          <dt className="text-[#94A3B8] font-bold">Refunds</dt>
          <dd className="font-extrabold">{p.refunds} · {inr(p.refundAmount)}</dd>
          <Rate value={p.refundRate} warn={p.refundRate >= 2 * Math.max(store.refundRate, 0.01) && p.refundRate >= 3} />
        </div>
      </dl>
      {(p.cancelledOrders > 0 || p.cancelledLines > 0) && (
        <p className="mt-2 text-[11.5px] text-[#64748B]">
          {p.cancelledOrders} whole order{p.cancelledOrders === 1 ? "" : "s"}, {p.cancelledLines} line{p.cancelledLines === 1 ? "" : "s"}
          {p.reasons?.length ? ` · ${p.reasons.map((r) => `“${r.reason}” ×${r.count}`).join(", ")}` : ""}
        </p>
      )}
      {p.flags.length > 0 && (
        <ul className="mt-2 space-y-1">
          {p.flags.map((f) => (
            <li key={f} className="flex gap-1.5 text-[12px] font-bold text-[#991B1B]">
              <MdWarningAmber size={15} className="shrink-0 mt-[1px]" /> {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const StaffWatch = ({ me }) => {
  const [period, setPeriod] = useState("7d");
  const [custom, setCustom] = useState({});
  const [stores, setStores] = useState([]);
  const params = { ...rangeFor(period, custom), ...(stores.length ? { stores: stores.join(",") } : {}) };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["partner-staff-watch", params],
    queryFn: () => partnersApi.staffWatch(params).then((r) => r.data.data),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Staff watch</h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">Who discounted, cancelled and refunded what. A flag is a question to ask, not proof.</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        <StoreFilter stores={me?.stores || []} selected={stores} onChange={setStores} />
      </div>

      {isError ? (
        <p className="text-[14px] font-bold text-[#B91C1C]">{errorMessage(error, "Could not load the staff watch.")}</p>
      ) : isLoading ? (
        <div className="h-40 rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
      ) : (
        <>
          <div className={`rounded-2xl border px-4 py-3 text-[13.5px] font-bold ${data.flagged ? "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]" : "bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]"}`}>
            {data.flagged ? `${data.flagged} staff member${data.flagged === 1 ? "" : "s"} stand out in this period.` : "Nobody stands out in this period."}
          </div>
          {data.stores.map((s) => (
            <section key={s.storeId} className="bg-white border border-[#E2E8F0] rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-extrabold">{s.name}</h2>
                <p className="text-[12px] font-bold text-[#64748B]">
                  Store: cancelled {s.store.cancelRate}% · discounts {s.store.discountRate}% · refunds {s.store.refundRate}% of {inr(s.store.sales)}
                </p>
              </div>
              {s.staff.length === 0 ? (
                <p className="text-[13px] text-[#94A3B8]">No orders in this period.</p>
              ) : (
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {s.staff.map((p) => (
                    <Person key={p.name} p={p} store={s.store} />
                  ))}
                </div>
              )}
              {s.events.length > 0 && (
                <details className="rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3 py-2">
                  <summary className="text-[12.5px] font-extrabold cursor-pointer">Paid bills cancelled and refunds of ₹1,000 or more ({s.events.length})</summary>
                  <ul className="mt-2 divide-y divide-[#E2E8F0]">
                    {s.events.map((e, i) => (
                      <li key={i} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[12.5px]">
                        <span className="min-w-0">
                          <span className="font-bold">{e.kind === "refund" ? "Refund" : "Paid bill cancelled"}</span> · #{e.ref} · {e.by}
                          {e.reason ? <span className="text-[#64748B]"> · {e.reason}</span> : null}
                        </span>
                        <span className="font-extrabold">
                          {inr(e.amount)} <span className="text-[11.5px] font-semibold text-[#94A3B8]">{dateGB(e.at)}, {time12(e.at)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          ))}
          <p className="text-[11.5px] text-[#94A3B8]">
            Who struck a single line off an order is recorded from 13 Nov 2026; earlier ones show as “Not recorded”. Customers (online) are QR, website and Knot Eats orders nobody rang up.
          </p>
        </>
      )}
    </div>
  );
};

export default StaffWatch;
