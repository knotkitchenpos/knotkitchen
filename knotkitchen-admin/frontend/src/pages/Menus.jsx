import { useEffect, useState } from "react";
import { getMenusApi, getRestaurantsApi, toggleMenuPublishApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default function Menus() {
  const [menus, setMenus] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await getMenusApi(selectedRestaurant || undefined);
      setMenus(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load menus");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getRestaurantsApi()
      .then((res) => setRestaurants(res.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [selectedRestaurant]);

  const togglePublish = async (id) => {
    try {
      await toggleMenuPublishApi(id);
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update menu");
    }
  };

  const resName = (id) => restaurants.find((r) => String(r._id) === String(id))?.name || "—";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Menus</h1>
          <p className="text-sm text-slate-500 mt-1">Menus across every registered restaurant</p>
        </div>
        <select
          value={selectedRestaurant}
          onChange={(e) => setSelectedRestaurant(e.target.value)}
          className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:border-emerald-500 outline-none"
        >
          <option value="">All restaurants</option>
          {restaurants.map((r) => (
            <option key={r._id} value={r._id}>{r.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : menus.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No menus found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {menus.map((m) => (
            <div key={m._id} className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg transition-shadow">
              <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 truncate">{m.name || "Untitled Menu"}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{resName(m.restaurantId)}</p>
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                  m.published || m.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"
                }`}>
                  {m.published || m.isPublished ? "Published" : "Draft"}
                </span>
              </div>

              <div className="px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">
                    {m.items?.length || 0} dish(es)
                  </span>
                  <span className="text-slate-500">
                    {m.categories?.length || 0} categor(ies)
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {(m.items || []).slice(0, 6).map((item) => (
                    <span key={item._id} className="px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-600">
                      {item.name} · {fmtINR(item.price)}
                    </span>
                  ))}
                  {(m.items?.length || 0) > 6 && (
                    <span className="px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-400">
                      +{(m.items?.length || 0) - 6} more
                    </span>
                  )}
                </div>
              </div>

              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Updated: {m.updatedAt ? new Date(m.updatedAt).toLocaleDateString("en-IN") : "—"}
                </span>
                <button
                  onClick={() => togglePublish(m._id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    m.published || m.isPublished
                      ? "bg-red-50 text-red-600 hover:bg-red-100"
                      : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  {m.published || m.isPublished ? "Unpublish" : "Publish"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}