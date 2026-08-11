import { useEffect, useState } from "react";
import { getTablesApi, getRestaurantsApi, updateTableApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const statusTone = {
  Available: "bg-emerald-50 text-emerald-700",
  Occupied: "bg-amber-50 text-amber-700",
  Reserved: "bg-sky-50 text-sky-700",
  Clean: "bg-slate-100 text-slate-600",
  "In-Use": "bg-violet-50 text-violet-700",
};

const statuses = ["Available", "Occupied", "Reserved", "Clean", "In-Use"];

export default function Tables() {
  const [tables, setTables] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await getTablesApi(selectedRestaurant || undefined);
      setTables(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load tables");
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

  const changeStatus = async (id, status) => {
    try {
      await updateTableApi(id, { status });
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update table");
    }
  };

  const resName = (id) => restaurants.find((r) => String(r._id) === String(id))?.name || "—";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Tables</h1>
          <p className="text-sm text-slate-500 mt-1">Front-of-house tables across every registered restaurant</p>
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
      ) : tables.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No tables found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3">Table</th>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3">Capacity</th>
                  <th className="px-4 py-3">QR</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Current Order</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {tables.map((t) => (
                  <tr key={t._id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-800">{t.tableNumber || "—"}</td>
                    <td className="px-4 py-3">{resName(t.restaurantId)}</td>
                    <td className="px-4 py-3 capitalize">{t.zone || "—"}</td>
                    <td className="px-4 py-3">{t.capacity || 0} seats</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${t.qrEnabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                        {t.qrEnabled ? "Enabled" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusTone[t.status] || "bg-slate-100 text-slate-600"}`}>
                        {t.status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {t.currentOrderId ? (
                        <span className="text-xs">
                          <span className="font-medium">{t.currentOrderId?.customerDetails?.name || "Customer"}</span>
                          <span className="text-slate-400 ml-1">· {fmtINR(t.currentOrderId?.bills?.totalWithTax)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={t.status}
                        onChange={(e) => changeStatus(t._id, e.target.value)}
                        className="px-2 py-1 rounded-lg border border-slate-300 bg-white text-xs focus:border-emerald-500 outline-none"
                      >
                        {statuses.map((s) => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}