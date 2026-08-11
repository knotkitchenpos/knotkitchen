import { useEffect, useState } from "react";
import { getOrdersApi, getRestaurantsApi, updateOrderStatusApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (d) => (d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

const statusTone = {
  Placed: "bg-sky-50 text-sky-700",
  Preparing: "bg-amber-50 text-amber-700",
  Ready: "bg-emerald-50 text-emerald-700",
  Served: "bg-violet-50 text-violet-700",
  Completed: "bg-green-50 text-green-700",
  Cancelled: "bg-red-50 text-red-600",
};

const statuses = ["Placed", "Preparing", "Ready", "Served", "Completed", "Cancelled"];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const params = {};
      if (selectedRestaurant) params.restaurantId = selectedRestaurant;
      if (statusFilter) params.status = statusFilter;
      const res = await getOrdersApi(selectedRestaurant, statusFilter);
      setOrders(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getRestaurantsApi()
      .then((res) => setRestaurants(res.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [selectedRestaurant, statusFilter]);

  const changeStatus = async (id, status) => {
    try {
      await updateOrderStatusApi(id, status);
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update order");
    }
  };

  const resName = (id) => restaurants.find((r) => String(r._id) === String(id))?.name || "—";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Orders</h1>
          <p className="text-sm text-slate-500 mt-1">Every order across all registered restaurants</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:border-emerald-500 outline-none"
          >
            <option value="">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No orders found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o._id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{resName(o.restaurantId)}</td>
                    <td className="px-4 py-3">{o.customerDetails?.name || "—"}</td>
                    <td className="px-4 py-3 capitalize">{o.orderType || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusTone[o.orderStatus] || "bg-slate-100 text-slate-600"}`}>
                        {o.orderStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold">{fmtINR(o.bills?.totalWithTax)}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(o.createdAt)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={o.orderStatus}
                        onChange={(e) => changeStatus(o._id, e.target.value)}
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