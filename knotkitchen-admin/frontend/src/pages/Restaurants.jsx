import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getRestaurantsApi, toggleRestaurantStatusApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = async () => {
    try {
      const res = await getRestaurantsApi();
      setRestaurants(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load restaurants");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = async (id) => {
    try {
      await toggleRestaurantStatusApi(id);
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update restaurant");
    }
  };

  const filtered = restaurants.filter((r) =>
    (r.name || "").toLowerCase().includes(query.toLowerCase()) ||
    (r.ownerId?.email || "").toLowerCase().includes(query.toLowerCase()) ||
    (r.ownerId?.phone || "").includes(query)
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registered Restaurants</h1>
          <p className="text-sm text-slate-500 mt-1">{restaurants.length} restaurant(s) on the platform</p>
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, phone..."
          className="w-full sm:w-72 px-4 py-2 rounded-lg border border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none text-sm"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No restaurants found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((r) => (
            <div key={r._id} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-shadow">
              <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
                <div className="min-w-0">
                  <Link to={`/restaurants/${r._id}`} className="text-lg font-bold text-slate-900 hover:text-emerald-600 transition-colors">
                    {r.name}
                  </Link>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {r.ownerId?.name || "Unknown owner"} • {r.ownerId?.email || "—"}
                  </p>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  r.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                }`}>
                  {r.isActive ? "Active" : "Suspended"}
                </span>
              </div>

              <div className="px-5 py-4 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-slate-900">{r.stats?.orderCount ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Orders</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">{r.stats?.menuCount ?? 0}</p>
                  <p className="text-[11px] text-slate-500">Menus</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">{fmtINR(r.stats?.revenue30d ?? 0)}</p>
                  <p className="text-[11px] text-slate-500">30d Rev</p>
                </div>
              </div>

              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  Plan: <span className="font-semibold capitalize">{r.subscription?.plan || "free"}</span>
                </span>
                <div className="flex gap-2">
                  <Link
                    to={`/restaurants/${r._id}`}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700 transition-colors"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => toggle(r._id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      r.isActive
                        ? "bg-red-50 text-red-600 hover:bg-red-100"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {r.isActive ? "Suspend" : "Activate"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}