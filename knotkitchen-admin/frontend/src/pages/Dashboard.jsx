import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getStatsApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getStatsApi();
        setStats(res.data || {});
      } catch (err) {
        setError(err?.response?.data?.message || "Failed to load stats");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return <p className="text-red-600 text-sm">{error}</p>;
  }

  const cards = [
    { label: "Registered Restaurants", value: stats?.restaurants || 0, link: "/restaurants", tone: "bg-emerald-500" },
    { label: "Platform Users", value: stats?.users || 0, link: "/users", tone: "bg-sky-500" },
    { label: "Orders (30d)", value: stats?.orders30d || 0, link: "/orders", tone: "bg-violet-500" },
    { label: "Revenue (30d)", value: fmtINR(stats?.revenue30d || 0), tone: "bg-amber-500" },
    { label: "Revenue Today", value: fmtINR(stats?.revenueToday || 0), tone: "bg-green-600" },
    { label: "Tables", value: stats?.tables || 0, link: "/tables", tone: "bg-rose-500" },
    { label: "Menu Categories", value: stats?.menus || 0, link: "/menus", tone: "bg-indigo-500" },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
        <p className="text-sm text-slate-500 mt-1">Real-time snapshot of every restaurant registered on KnotKitchen</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((c) => {
          const inner = (
            <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-lg transition-shadow">
              <div className={`w-10 h-10 rounded-lg ${c.tone} flex items-center justify-center text-white font-bold mb-3`}>
                {typeof c.value === "number" ? c.value.toLocaleString() : c.value.slice(0, 1)}
              </div>
              <p className="text-2xl font-bold text-slate-900">{c.value}</p>
              <p className="text-sm text-slate-500 mt-0.5">{c.label}</p>
            </div>
          );
          return c.link ? (
            <Link key={c.label} to={c.link}>{inner}</Link>
          ) : (
            <div key={c.label}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}