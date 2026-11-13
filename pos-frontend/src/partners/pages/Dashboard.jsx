import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MdWarning, MdLock, MdAccountBalanceWallet, MdEventRepeat, MdLink } from "react-icons/md";
import { partnersApi, errorMessage } from "../api";
import { inr, dateGB } from "../../utils";
import { Card, ColumnChart, BarList, StatTile } from "../components/charts";
import { PeriodPicker, StoreFilter, rangeFor } from "../components/Filters";

const ALERT = {
  locked: { Icon: MdLock, tone: "bg-[#FEF2F2] border-[#FECACA] text-[#991B1B]", text: (a) => `Locked${a.lockedReason ? `: ${a.lockedReason}` : " for non-payment"}`, to: "/billing", cta: "Open Billing" },
  wallet: { Icon: MdAccountBalanceWallet, tone: "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]", text: (a) => `Wallet low: ${a.wallet?.label || "₹0"}`, to: "/billing", cta: "Top up" },
  renewal: { Icon: MdEventRepeat, tone: "bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]", text: (a) => `Plan renews ${a.renewsOn ? dateGB(a.renewsOn) : "soon"}`, to: "/billing", cta: "View plan" },
  link: { Icon: MdLink, tone: "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]", text: () => "Password changed: confirm the link", to: "/stores", cta: "Confirm" },
};

const hourLabel = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;
const nextDay = (ymd) => new Date(new Date(`${ymd}T12:00:00+05:30`).getTime() + 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const shortDay = (ymd) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

const Dashboard = ({ me }) => {
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState({});
  const [stores, setStores] = useState([]);
  const range = rangeFor(period, custom);
  const params = { ...range, ...(stores.length ? { stores: stores.join(",") } : {}) };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["partner-dashboard", params],
    queryFn: () => partnersApi.dashboard(params).then((r) => r.data.data),
    refetchInterval: period === "today" ? 60_000 : false,
  });

  const single = range.from === range.to;
  const series = useMemo(() => {
    if (!data) return [];
    // Every hour from the first sale to the last (at least 9am to 11pm), and
    // every day of the period: a quiet hour or day is a zero bar, not a gap.
    if (single) {
      const by = new Map((data.byHour || []).map((h) => [h.hour, h]));
      const hours = [...by.keys()];
      const first = Math.min(9, ...hours);
      const last = Math.max(23, ...hours);
      return Array.from({ length: last - first + 1 }, (_, i) => {
        const hr = first + i;
        const h = by.get(hr);
        return { key: hr, label: `${hourLabel(hr)}–${hourLabel((hr + 1) % 24)}`, short: hourLabel(hr), value: h?.amount || 0, sub: `${h?.count || 0} orders` };
      });
    }
    const by = new Map((data.daily || []).map((d) => [d.day, d]));
    const days = [];
    for (let d = range.from; d <= range.to && days.length < 400; d = nextDay(d)) days.push(d);
    return days.map((day) => ({ key: day, label: shortDay(day), value: by.get(day)?.amount || 0, sub: `${by.get(day)?.count || 0} orders` }));
  }, [data, single, range.from, range.to]);

  const t = data?.totals;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">{greeting}{me?.name ? `, ${me.name.split(" ")[0]}` : ""}</h1>
          <p className="text-[13px] text-[#64748B] mt-0.5">
            Sales across {stores.length || (me?.stores || []).filter((s) => s.linkStatus === "ok").length} store(s) · {single ? dateGB(`${range.from}T12:00:00+05:30`) : `${dateGB(`${range.from}T12:00:00+05:30`)} – ${dateGB(`${range.to}T12:00:00+05:30`)}`}
            {isFetching && !isLoading ? " · updating…" : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <PeriodPicker period={period} onPeriod={setPeriod} custom={custom} onCustom={setCustom} />
        <StoreFilter stores={me?.stores || []} selected={stores} onChange={setStores} />
      </div>

      {data?.alerts?.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.alerts.map((a) => {
            const A = ALERT[a.kind] || ALERT.wallet;
            return (
              <div key={`${a.storeId}-${a.kind}`} className={`flex items-center gap-3 border rounded-xl px-3.5 py-3 ${A.tone}`}>
                <A.Icon size={20} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold truncate">{a.name}</p>
                  <p className="text-[12px] font-semibold truncate">{A.text(a)}</p>
                </div>
                <Link to={A.to} className="shrink-0 text-[12.5px] font-extrabold underline">{A.cta}</Link>
              </div>
            );
          })}
        </div>
      )}

      {isError ? (
        <div className="bg-white border border-[#FECACA] rounded-2xl p-6 text-center">
          <MdWarning className="mx-auto text-[#DC2626]" size={28} />
          <p className="mt-2 text-[14px] font-bold">{errorMessage(error, "Could not load the dashboard.")}</p>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[112px] rounded-2xl bg-white border border-[#E2E8F0] animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <StatTile label="Sales" value={inr(t.sales)} change={t.salesChange} />
            <StatTile label="Orders" value={t.orders.toLocaleString("en-IN")} change={t.ordersChange} />
            <StatTile label="Average bill" value={inr(t.average)} change={t.averageChange} />
            <StatTile label="Cancelled" value={t.cancelled.toLocaleString("en-IN")} hint={t.cancelled ? `${inr(t.cancelledAmount)} not sold` : "None"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title={single ? "Sales by hour" : "Sales by day"} subtitle={single ? "Takings each hour of the day" : "Takings each day"} className="lg:col-span-2">
              <ColumnChart rows={series} />
            </Card>
            <Card title="Stores" subtitle="Sales in this period">
              <BarList
                rows={(data.stores || []).map((s) => ({ key: s.storeId, label: s.name, value: s.sales, count: s.orders }))}
                emptyText="No linked store to show."
              />
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card title="Channels" subtitle="Where the orders came from">
              <BarList rows={(data.channels || []).map((c) => ({ key: c.key, label: c.label, value: c.amount, count: c.count }))} emptyText="No sales yet." />
            </Card>
            <Card title="Payments" subtitle="How customers paid">
              <BarList rows={(data.payments || []).map((c) => ({ key: c.key, label: c.label, value: c.amount, count: c.count }))} emptyText="No payments yet." />
            </Card>
            <Card title="Top products" subtitle="By quantity sold" className="md:col-span-2 xl:col-span-1">
              {data.topItems?.length ? (
                <ol className="divide-y divide-[#F1F5F9]">
                  {data.topItems.map((it, i) => (
                    <li key={it.name} className="flex items-center gap-3 py-2.5">
                      <span className="w-6 h-6 rounded-full bg-[#FFF1E8] text-[#C2410C] text-[11.5px] font-extrabold flex items-center justify-center shrink-0">{i + 1}</span>
                      <span className="min-w-0 flex-1 text-[13px] font-bold leading-snug line-clamp-2 break-words" title={it.name}>{it.name}</span>
                      <span className="text-[12.5px] font-bold text-[#64748B] shrink-0">× {Number(it.quantity).toLocaleString("en-IN")}</span>
                      <span className="text-[13px] font-extrabold shrink-0 text-right">{inr(it.amount)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-6 text-center text-[13px] text-[#94A3B8]">No products sold yet.</p>
              )}
            </Card>
          </div>

          {data.stores?.length > 1 && (
            <Card title="Store comparison" subtitle="This period against the one before">
              <div className="overflow-x-auto -mx-1">
                <table className="w-full min-w-[560px] text-[13px]">
                  <thead>
                    <tr className="text-left text-[11.5px] uppercase tracking-wide text-[#64748B]">
                      <th className="py-2 px-1 font-bold">Store</th>
                      <th className="py-2 px-1 font-bold text-right">Sales</th>
                      <th className="py-2 px-1 font-bold text-right">Change</th>
                      <th className="py-2 px-1 font-bold text-right">Orders</th>
                      <th className="py-2 px-1 font-bold text-right">Avg bill</th>
                      <th className="py-2 px-1 font-bold text-right">Cancelled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1F5F9]">
                    {data.stores.map((s) => (
                      <tr key={s.storeId}>
                        <td className="py-2.5 px-1 font-bold">{s.name}</td>
                        <td className="py-2.5 px-1 text-right font-extrabold">{inr(s.sales)}</td>
                        <td className={`py-2.5 px-1 text-right font-bold ${s.salesChange > 0 ? "text-[#15803D]" : s.salesChange < 0 ? "text-[#B91C1C]" : "text-[#94A3B8]"}`}>
                          {s.salesChange == null ? "—" : `${s.salesChange > 0 ? "+" : ""}${s.salesChange}%`}
                        </td>
                        <td className="py-2.5 px-1 text-right">{s.orders}</td>
                        <td className="py-2.5 px-1 text-right">{inr(s.average)}</td>
                        <td className="py-2.5 px-1 text-right">{s.cancelled}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {data.skipped?.length > 0 && (
            <p className="text-[12.5px] text-[#B45309]">
              Not included: {data.skipped.map((s) => `store ${s.storeId}`).join(", ")}. Confirm their link on the <Link to="/stores" className="underline font-bold">Stores</Link> page.
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;
