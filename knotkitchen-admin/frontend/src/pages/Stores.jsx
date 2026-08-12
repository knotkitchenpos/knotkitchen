import { useEffect, useState } from "react";
import { createStoreApi, getStoresApi } from "../api";

export default function Stores() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [createdStore, setCreatedStore] = useState(null);

  // Form state
  const [storeName, setStoreName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadStores = async () => {
    try {
      const res = await getStoresApi();
      setStores(res.data || res || []);
    } catch (err) {
      setError(err?.response?.data?.message || "Failed to load stores");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const handleCreateStore = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!storeName.trim() || !ownerName.trim() || !ownerPhone.trim()) {
      setFormError("All fields (Store Name, Owner Name, Owner Phone) are required.");
      return;
    }

    if (!/^\d{10}$/.test(ownerPhone.trim())) {
      setFormError("Owner phone number must be exactly 10 digits.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createStoreApi({
        storeName: storeName.trim(),
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
      });

      const storeData = res.data || res;
      setCreatedStore(storeData);
      setModalOpen(false);
      setStoreName("");
      setOwnerName("");
      setOwnerPhone("");
      loadStores();
    } catch (err) {
      setFormError(err?.response?.data?.message || "Failed to create store.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Store Onboarding & Management</h1>
          <p className="text-sm text-slate-500 mt-1">
            Create stores after agreement completion. Automatically generate 6-digit Store IDs.
          </p>
        </div>
        <button
          onClick={() => {
            setFormError("");
            setModalOpen(true);
          }}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2"
        >
          <span>+ Create New Store</span>
        </button>
      </div>

      {/* Success Banner when store is created */}
      {createdStore && (
        <div className="mb-6 p-6 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-emerald-900 flex items-center gap-2">
              <span className="text-xl">✅</span> Store Created Successfully
            </h3>
            <button
              onClick={() => setCreatedStore(null)}
              className="text-xs text-emerald-700 font-semibold hover:underline"
            >
              Dismiss
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="bg-white p-3 rounded-lg border border-emerald-100">
              <p className="text-xs text-slate-500">Store Name</p>
              <p className="font-bold text-slate-800">{createdStore.storeName}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-emerald-100">
              <p className="text-xs text-slate-500">Owner Name</p>
              <p className="font-bold text-slate-800">{createdStore.ownerName}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border border-emerald-100">
              <p className="text-xs text-slate-500">Owner Phone</p>
              <p className="font-bold text-slate-800">{createdStore.ownerPhone}</p>
            </div>
            <div className="bg-emerald-600 p-3 rounded-lg text-white">
              <p className="text-xs text-emerald-100">Generated Store ID</p>
              <p className="text-xl font-mono font-bold tracking-widest">{createdStore.storeId}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stores List */}
      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-600 text-sm">{error}</p>
      ) : stores.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <p className="text-slate-500 font-medium">No stores onboarded yet.</p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-4 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold"
          >
            Create First Store
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3">Store ID</th>
                <th className="px-6 py-3">Store Name</th>
                <th className="px-6 py-3">Owner Name</th>
                <th className="px-6 py-3">Owner Phone</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stores.map((s) => (
                <tr key={s._id || s.storeId} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-bold text-emerald-600">{s.storeId}</td>
                  <td className="px-6 py-4 font-semibold text-slate-900">{s.storeName}</td>
                  <td className="px-6 py-4">{s.ownerName}</td>
                  <td className="px-6 py-4">{s.ownerPhone}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                        s.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : s.status === "pending"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Create Store */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900">Create New Store</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateStore} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Store Name</label>
                <input
                  type="text"
                  placeholder="e.g. Demo Takeaway 01"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Owner Name</label>
                <input
                  type="text"
                  placeholder="e.g. Demo Owner"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Owner Phone Number (10 digits)</label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210"
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  maxLength={10}
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {submitting ? "Creating..." : "Create Store"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
