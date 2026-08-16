import React, { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getOrders, getPopularItems } from "../https";

const money = (n) => `₹${Number(n || 0).toFixed(2)}`;

const Card = ({ label, value, tint }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-xl px-5 py-4">
    <p className="text-[12px] font-semibold text-[#94A3B8]">{label}</p>
    <p className="text-[26px] font-extrabold mt-1" style={{ color: tint || "#0F172A" }}>
      {value}
    </p>
  </div>
);

const Reports = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Reports";
  }, []);

  const { data: ordersRes, isLoading } = useQuery({ queryKey: ["orders"], queryFn: getOrders });
  const { data: popRes } = useQuery({
    queryKey: ["popular-items"],
    queryFn: () => getPopularItems({ limit: 12, days: 30 }),
  });

  const orders = ordersRes?.data?.data || [];
  const popular = popRes?.data?.data || [];

  const s = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    let today = 0, todayRev = 0, totalRev = 0, done = 0, cancelled = 0, ongoing = 0;
    const byType = {};
    orders.forEach((o) => {
      const amt = Number(o.bills?.totalWithTax || o.bills?.total || 0);
      if (o.orderStatus !== "Cancelled") totalRev += amt;
      if (new Date(o.createdAt) >= start) {
        today += 1;
        if (o.orderStatus !== "Cancelled") todayRev += amt;
      }
      if (o.orderStatus === "Completed") done += 1;
      else if (o.orderStatus === "Cancelled") cancelled += 1;
      else ongoing += 1;
      const t = o.orderType || "other";
      byType[t] = (byType[t] || 0) + 1;
    });
    return {
      today, todayRev, totalRev, done, cancelled, ongoing, byType,
      total: orders.length,
      avg: orders.length ? totalRev / orders.length : 0,
    };
  }, [orders]);

  return (
    <div className="h-full w-full overflow-y-auto bg-[#F8FAFC]">
      <div className="max-w-[1400px] mx-auto px-7 py-6">
        <h1 className="text-[28px] font-extrabold text-[#0F172A] tracking-tight">Reports</h1>
        <p className="text-[13.5px] text-[#94A3B8] mt-1">
          Store-specific performance — orders, revenue and popular items for your takeaway.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <div className="w-9 h-9 rounded-full border-[3px] border-[#5B42F3] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
              <Card label="Orders Today" value={s.today} />
              <Card label="Revenue Today" value={money(s.todayRev)} tint="#16A34A" />
              <Card label="Total Orders" value={s.total} />
              <Card label="Avg Order Value" value={money(s.avg)} tint="#5B42F3" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
              <Card label="Completed" value={s.done} tint="#16A34A" />
              <Card label="Ongoing" value={s.ongoing} tint="#EA580C" />
              <Card label="Cancelled" value={s.cancelled} tint="#DC2626" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
                <h2 className="text-[16px] font-extrabold text-[#0F172A] mb-3">Orders by Type</h2>
                {Object.keys(s.byType).length === 0 ? (
                  <p className="text-[13px] text-[#94A3B8]">No orders yet.</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(s.byType).map(([t, n]) => (
                      <div key={t} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                        <span className="text-[13.5px] font-bold text-[#334155] capitalize">{t}</span>
                        <span className="text-[13.5px] font-extrabold text-[#5B42F3]">{n}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
                <h2 className="text-[16px] font-extrabold text-[#0F172A] mb-3">Popular Items</h2>
                {popular.length === 0 ? (
                  <p className="text-[13px] text-[#94A3B8]">
                    No popular items yet — this appears once your store has order history.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                    {popular.map((it) => (
                      <div key={it._id} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0]">
                        <div className="min-w-0">
                          <p className="text-[13.5px] font-bold text-[#0F172A] truncate">{it.name}</p>
                          <p className="text-[11px] text-[#94A3B8] truncate">
                            {it.categoryName || it.category}
                            {it.fallback ? " · default" : ""}
                          </p>
                        </div>
                        <span className="text-[13px] font-extrabold text-[#5B42F3] shrink-0 ml-3">
                          {it.totalQty ? `${it.totalQty} sold` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Reports;
