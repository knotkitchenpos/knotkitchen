import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getRestaurantApi, toggleRestaurantStatusApi } from "../api";

const fmtINR = (n) => "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

const statusTone = {
  Placed: "bg-sky-50 text-sky-700",
  Preparing: "bg-amber-50 text-amber-700",
  Ready: "bg-emerald-50 text-emerald-700",
  Served: "bg-violet-50 text-violet-700",
  Completed: "bg-green-50 text-green-700",
  Cancelled: "bg-red-50 text-red-600",
};

export default function RestaurantDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await getRestaurantApi(id);
      setData(res.data || {});
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load restaurant");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const toggle = async () => {
    try {
      await toggleRestaurantStatusApi(id);
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update restaurant");
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) return <p className="text-red-600 text-sm">{error}</p>;

  const { restaurant, menus, orders, tables, staff } = data;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <Link to="/restaurants" className="text-sm text-slate-500 hover:text-emerald-600 mb-1 inline-block">← Back to restaurants</Link>
          <h1 className="text-2xl font-bold text-slate-900">{restaurant?.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5 truncate">{restaurant?.address?.city || "—"}, {restaurant?.address?.state || "—"}</p>
        </div>
        <button
          onClick={toggle}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            restaurant?.isActive
              ? "bg-red-50 text-red-600 hover:bg-red-100"
              : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
          }`}
        >
          {restaurant?.isActive ? "Suspend Restaurant" : "Activate Restaurant"}
        </button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Recent Orders", value: orders?.length || 0 },
          { label: "Menus", value: menus?.length || 0 },
          { label: "Tables", value: tables?.length || 0 },
          { label: "Staff", value: staff?.length || 0 },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-5">
            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="text-sm text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Owner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h2 className="font-bold text-slate-900 mb-3">Owner Account</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-slate-500 text-xs">Name</p>
            <p className="font-semibold text-slate-800">{restaurant?.ownerId?.name || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Email</p>
            <p className="font-semibold text-slate-800">{restaurant?.ownerId?.email || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Phone</p>
            <p className="font-semibold text-slate-800">{restaurant?.ownerId?.phone || "—"}</p>
          </div>
          <div>
            <p className="text-slate-500 text-xs">Joined</p>
            <p className="font-semibold text-slate-800">{fmtDate(restaurant?.ownerId?.createdAt)}</p>
          </div>
        </div>
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Recent Orders</h2>
        </div>
        {orders?.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500">No orders yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="px-5 py-3">Customer</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders?.map((o) => (
                <tr key={o._id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{o.customerDetails?.name || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusTone[o.orderStatus] || "bg-slate-100 text-slate-600"}`}>
                      {o.orderStatus}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-semibold">{fmtINR(o.bills?.totalWithTax)}</td>
                  <td className="px-5 py-3 text-slate-500">{fmtDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}