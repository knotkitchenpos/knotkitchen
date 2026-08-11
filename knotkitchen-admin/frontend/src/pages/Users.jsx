import { useEffect, useState } from "react";
import { getUsersApi, getRestaurantsApi, updateUserApi } from "../api";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");

export default function Users() {
  const [users, setUsers] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurant, setSelectedRestaurant] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await getUsersApi(selectedRestaurant || undefined);
      setUsers(res.data || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load users");
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

  const toggleActive = async (u) => {
    try {
      await updateUserApi(u._id, { isActive: !u.isActive });
      await load();
    } catch (err) {
      alert(err?.response?.data?.message || "Failed to update user");
    }
  };

  const resName = (id) => restaurants.find((r) => String(r._id) === String(id))?.name || "—";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">All Users</h1>
          <p className="text-sm text-slate-500 mt-1">Staff accounts across every registered restaurant</p>
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
      ) : users.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No users found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Restaurant</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Joined</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold capitalize">{u.role}</span>
                    </td>
                    <td className="px-4 py-3">{resName(u.restaurantId)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                        {u.isActive ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(u.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(u)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          u.isActive
                            ? "bg-red-50 text-red-600 hover:bg-red-100"
                            : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        {u.isActive ? "Disable" : "Enable"}
                      </button>
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