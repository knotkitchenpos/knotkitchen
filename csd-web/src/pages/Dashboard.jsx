import React, { useEffect, useState } from "react";
import {
  FiShoppingBag, FiCheckCircle, FiSlash, FiFileText, FiTrendingUp, FiPlusCircle,
} from "react-icons/fi";
import { dashboard, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import { inrWhole as inr, num } from "../lib/format";



const KpiCard = ({ icon: Icon, label, value, hint, tone = "navy" }) => {
  const tones = {
    navy: "bg-navy-100 text-navy-700",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    orange: "bg-brand-100 text-brand-700",
  };
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-navy-200 bg-white p-5 hover:-translate-y-0.5 hover:shadow-pop">
      {/* a hairline of brand colour along the top, lit on hover */}
      <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-brand-500 to-brand-300 opacity-40 group-hover:opacity-100" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-tight text-navy-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-navy-500">{hint}</p>}
        </div>
        <span className={`shrink-0 rounded-xl p-2.5 ${tones[tone]}`}>
          <Icon size={20} aria-hidden="true" />
        </span>
      </div>
    </div>
  );
};

/**
 * Compact bar chart — avoids pulling a charting dependency for six values.
 *
 * Bar heights are in PIXELS, not percentages: a percentage height only
 * resolves against a parent with a definite height, and inside a flex column
 * whose height comes from its content that is circular, so the bars collapse
 * to nothing. Labels sit in a sibling row so they don't consume bar space.
 */
const MAX_BAR_PX = 130;

const TrendChart = ({ trend }) => {
  if (!trend?.length) return <p className="text-sm text-navy-500">No orders recorded yet.</p>;
  const max = Math.max(...trend.map((t) => t.revenue), 1);

  const monthLabel = (month) => {
    const [y, m] = month.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short" });
  };

  return (
    <div>
      <div className="flex items-end gap-3 sm:gap-5" style={{ height: MAX_BAR_PX + 20 }}>
        {trend.map((t) => (
          <div key={t.month} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[11px] font-medium text-navy-600">{inr(t.revenue)}</span>
            <div
              className="w-full origin-bottom rounded-t-lg bg-gradient-to-t from-brand-600 to-brand-400 animate-grow"
              // Floor of 4px so a non-zero month is never invisible.
              style={{ height: Math.max(Math.round((t.revenue / max) * MAX_BAR_PX), 4) }}
              title={`${t.orders} orders · ${inr(t.revenue)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 border-t border-navy-100 pt-2 sm:gap-5">
        {trend.map((t) => (
          <div key={t.month} className="flex-1 text-center">
            <div className="text-xs font-medium text-navy-600">{monthLabel(t.month)}</div>
            <div className="text-[11px] text-navy-400">{num(t.orders)} orders</div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    dashboard
      .get()
      .then((d) => alive && setData(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load the dashboard.")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <p className="text-sm text-navy-500">Loading dashboard…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  const k = data.kpis;

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900">Dashboard</h1>
        <p className="mt-1 text-sm text-navy-500">
          Platform overview for {data.period.label} · all figures in {data.period.timezone}
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon={FiShoppingBag}
          label="Registered restaurants"
          value={num(k.totalRegistered)}
          hint="All restaurants on KnotKitchen"
        />
        <KpiCard
          icon={FiCheckCircle}
          tone="green"
          label="Active restaurants"
          value={num(k.totalActive)}
          hint="Currently trading"
        />
        <KpiCard
          icon={FiSlash}
          tone="red"
          label="Disabled restaurants"
          value={num(k.totalDisabled)}
          hint="Suspended or no longer using KnotKitchen"
        />
        <KpiCard
          icon={FiFileText}
          label="Orders this month"
          value={num(k.ordersThisMonth)}
          hint="Across all restaurants, excluding cancellations"
        />
        <KpiCard
          icon={FiTrendingUp}
          tone="orange"
          label="Revenue this month"
          value={inr(k.revenueThisMonth)}
          hint="Across all restaurants, excluding cancellations"
        />
        <KpiCard
          icon={FiPlusCircle}
          label="New stores this month"
          value={num(k.newStoresThisMonth)}
          hint="Onboarded since the 1st"
        />
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-navy-200 bg-white p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-navy-700">
            Revenue &amp; orders — last 6 months
          </h2>
          <TrendChart trend={data.trend} />
        </div>

        <div className="rounded-2xl border border-navy-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-700">
            Stores by status
          </h2>
          {data.statusBreakdown.length === 0 ? (
            <p className="text-sm text-navy-500">No stores yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {data.statusBreakdown.map((s) => (
                <li key={s.status} className="flex items-center justify-between gap-3">
                  <StatusBadge status={s.status} />
                  <span className="font-semibold text-navy-900">{num(s.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
