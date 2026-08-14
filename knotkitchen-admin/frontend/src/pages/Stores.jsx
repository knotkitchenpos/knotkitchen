import { useEffect, useState } from "react";
import {
  createStoreApi,
  getStoresApi,
  sendStoreOtpApi,
  updateStoreStatusApi,
  deleteStoreApi,
} from "../api";

export default function Stores() {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [otpStep, setOtpStep] = useState(1); // 1: Info, 2: OTP verification
  const [createdStore, setCreatedStore] = useState(null);

  // Form state
  const [storeName, setStoreName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sentOtpHint, setSentOtpHint] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Action Modal State (Close Until / Delete / Close Temp)
  const [actionStore, setActionStore] = useState(null);
  const [actionType, setActionType] = useState(""); // "close_temp" | "close_until" | "delete"
  const [closedUntilDate, setClosedUntilDate] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [actionSubmitting, setActionSubmitting] = useState(false);

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

  const resetModalForm = () => {
    setModalOpen(false);
    setOtpStep(1);
    setStoreName("");
    setOwnerName("");
    setOwnerPhone("");
    setOtp("");
    setSentOtpHint("");
    setFormError("");
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!storeName.trim() || !ownerName.trim() || !ownerPhone.trim()) {
      setFormError("All fields (Store Name, Owner Name, Registered Phone) are required.");
      return;
    }

    if (!/^\d{10}$/.test(ownerPhone.trim())) {
      setFormError("Registered Phone Number must be exactly 10 digits.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await sendStoreOtpApi({
        storeName: storeName.trim(),
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
      });

      const data = res.data || res;
      if (data?.otp) {
        setSentOtpHint(data.otp);
      }
      setOtpStep(2);
    } catch (err) {
      setFormError(err?.response?.data?.message || "Failed to send OTP to registered phone.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStore = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!otp.trim()) {
      setFormError("Please enter the 6-digit OTP received on the registered phone.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createStoreApi({
        storeName: storeName.trim(),
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
        otp: otp.trim(),
      });

      const storeData = res.data || res;
      setCreatedStore(storeData);
      resetModalForm();
      loadStores();
    } catch (err) {
      setFormError(err?.response?.data?.message || "Failed to verify OTP and create store.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStoreAction = async (store, type) => {
    setActionStore(store);
    setActionType(type);
    setClosedUntilDate("");
    setClosureReason("");

    if (type === "activate") {
      try {
        await updateStoreStatusApi(store._id, { action: "activate" });
        loadStores();
        setActionStore(null);
      } catch (err) {
        alert(err?.response?.data?.message || "Failed to update store status");
      }
    }
  };

  const submitStoreAction = async (e) => {
    e.preventDefault();
    if (!actionStore) return;

    setActionSubmitting(true);
    try {
      if (actionType === "delete") {
        await deleteStoreApi(actionStore._id);
      } else if (actionType === "close_temp") {
        await updateStoreStatusApi(actionStore._id, {
          action: "close_temporarily",
          closureReason,
        });
      } else if (actionType === "close_until") {
        if (!closedUntilDate) {
          alert("Please select a date and time to close until.");
          setActionSubmitting(false);
          return;
        }
        await updateStoreStatusApi(actionStore._id, {
          action: "close_until",
          closedUntil: closedUntilDate,
          closureReason,
        });
      }
      setActionStore(null);
      loadStores();
    } catch (err) {
      alert(err?.response?.data?.message || "Operation failed.");
    } finally {
      setActionSubmitting(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Store Onboarding & Operations</h1>
          <p className="text-sm text-slate-500 mt-1">
            Authenticate registered phone via OTP, generate 6-digit Store IDs, and manage store operational status.
          </p>
        </div>
        <button
          onClick={() => {
            resetModalForm();
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
              <span className="text-xl">✅</span> Store Authenticated & Created Successfully
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
              <p className="text-xs text-slate-500">Registered Phone</p>
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
                <th className="px-6 py-3">Owner Details</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Closure Details</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stores.map((s) => {
                const isClosedUntilActive =
                  s.status === "closed_until" && s.closedUntil && new Date(s.closedUntil) > new Date();

                return (
                  <tr key={s._id || s.storeId} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-mono font-bold text-emerald-600">{s.storeId}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900">{s.storeName}</td>
                    <td className="px-6 py-4">
                      <p className="font-medium text-slate-800">{s.ownerName}</p>
                      <p className="text-xs text-slate-500 font-mono">{s.ownerPhone}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize inline-flex items-center gap-1 ${
                          s.status === "active"
                            ? "bg-emerald-50 text-emerald-700"
                            : s.status === "closed_temporarily"
                            ? "bg-amber-50 text-amber-700"
                            : s.status === "closed_until"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                        {s.status === "closed_temporarily"
                          ? "Closed Temporarily"
                          : s.status === "closed_until"
                          ? "Closed Until Date"
                          : s.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 max-w-xs">
                      {s.status === "closed_until" && s.closedUntil ? (
                        <div>
                          <p className="font-semibold text-purple-900">
                            Until: {new Date(s.closedUntil).toLocaleString()}
                          </p>
                          {s.closureReason && <p className="italic text-slate-500">{s.closureReason}</p>}
                        </div>
                      ) : s.status === "closed_temporarily" ? (
                        <p className="italic text-amber-800">{s.closureReason || "Closed temporarily"}</p>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {s.status !== "active" ? (
                          <button
                            onClick={() => handleStoreAction(s, "activate")}
                            className="px-2.5 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-semibold"
                          >
                            Re-activate
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleStoreAction(s, "close_temp")}
                              className="px-2.5 py-1 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded text-xs font-semibold"
                            >
                              Close Temp
                            </button>
                            <button
                              onClick={() => handleStoreAction(s, "close_until")}
                              className="px-2.5 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded text-xs font-semibold"
                            >
                              Close Till Date
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleStoreAction(s, "delete")}
                          className="px-2.5 py-1 bg-red-50 text-red-700 hover:bg-red-100 rounded text-xs font-semibold"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Create Store with OTP Verification */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Create New Store</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {otpStep === 1 ? "Step 1: Enter Store & Registered Phone Details" : "Step 2: Authenticate OTP"}
                </p>
              </div>
              <button onClick={() => resetModalForm()} className="text-slate-400 hover:text-slate-600 font-bold text-lg">
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-lg font-medium">
                {formError}
              </div>
            )}

            {otpStep === 1 ? (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Store Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Royal Spice Bistro"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Owner Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Rahul Sharma"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Registered Phone Number (10 digits)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                    maxLength={10}
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => resetModalForm()}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {submitting ? "Sending OTP..." : "Send Verification OTP →"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCreateStore} className="space-y-4">
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
                  <p className="font-semibold">OTP sent to registered phone +91 {ownerPhone}</p>
                  {sentOtpHint && (
                    <p className="mt-1 font-mono text-emerald-700">
                      Dev OTP code: <span className="font-bold tracking-widest text-emerald-900">{sentOtpHint}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Enter 6-Digit OTP</label>
                  <input
                    type="text"
                    placeholder="Enter 6-digit OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    className="w-full px-4 py-3 text-center tracking-widest font-mono text-xl border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                    maxLength={6}
                    required
                    autoFocus
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setOtpStep(1)}
                    className="text-xs text-slate-500 font-semibold hover:text-slate-700"
                  >
                    ← Edit Phone Number
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => resetModalForm()}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {submitting ? "Verifying..." : "Verify & Create Store"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Store Action (Close Temp / Close Until / Delete) */}
      {actionStore && actionType && actionType !== "activate" && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">
                {actionType === "delete"
                  ? "Delete Store"
                  : actionType === "close_temp"
                  ? "Close Store Temporarily"
                  : "Close Store Until Specific Date"}
              </h2>
              <button
                onClick={() => setActionStore(null)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              Target Store: <span className="font-bold text-slate-900">{actionStore.storeName}</span> (ID:{" "}
              <span className="font-mono text-emerald-600">{actionStore.storeId}</span>)
            </p>

            <form onSubmit={submitStoreAction} className="space-y-4">
              {actionType === "close_until" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Reopen Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={closedUntilDate}
                    onChange={(e) => setClosedUntilDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                    required
                  />
                </div>
              )}

              {actionType !== "delete" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Reason / Note for Operators (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Scheduled renovation, Holiday closure"
                    value={closureReason}
                    onChange={(e) => setClosureReason(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
              )}

              {actionType === "delete" && (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                  ⚠️ Are you sure you want to delete this store? The store will be marked as deleted and cannot log in to POS.
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActionStore(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionSubmitting}
                  className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 ${
                    actionType === "delete"
                      ? "bg-red-600 hover:bg-red-700"
                      : actionType === "close_until"
                      ? "bg-purple-600 hover:bg-purple-700"
                      : "bg-amber-600 hover:bg-amber-700"
                  }`}
                >
                  {actionSubmitting
                    ? "Processing..."
                    : actionType === "delete"
                    ? "Confirm Delete"
                    : actionType === "close_until"
                    ? "Set Closure Date"
                    : "Close Temporarily"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
