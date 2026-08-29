import React, { useEffect, useState } from "react";
import { FiX } from "react-icons/fi";
import { jobs as jobsApi, stores as storesApi, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

const JobCreateDialog = ({ onClose, onCreated }) => {
  const { staff } = useAuth();
  const [form, setForm] = useState({
    title: "", description: "", storeId: "", priority: "normal", deadline: "", assignedToId: "",
  });
  const [assignees, setAssignees] = useState([]);
  const [storeHits, setStoreHits] = useState([]);
  const [storeQuery, setStoreQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    jobsApi.assignees().then(setAssignees).catch(() => setAssignees([]));
  }, []);

  // Look the store up by name so the operator doesn't have to know its ID.
  useEffect(() => {
    const q = storeQuery.trim();
    if (q.length < 2) {
      setStoreHits([]);
      return undefined;
    }
    const t = setTimeout(() => {
      storesApi.search({ q, limit: 5 }).then((d) => setStoreHits(d.results)).catch(() => setStoreHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [storeQuery]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const set = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await jobsApi.create({
        ...form,
        assignedToId: form.assignedToId || undefined,
        deadline: form.deadline || undefined,
        storeId: form.storeId || undefined,
      });
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "Could not create the job."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label="Create job"
        className="my-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy-900">New job</h2>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Title <span className="text-brand-600">*</span>
            </span>
            <input name="title" value={form.title} onChange={set} required minLength={3}
              placeholder="e.g. Update restaurant menu for ABC Restaurant"
              className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Description
            </span>
            <textarea name="description" value={form.description} onChange={set} rows={4}
              placeholder="What needs doing, and anything the assignee will need to know."
              className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Link a restaurant
            </span>
            {form.storeId ? (
              <div className="flex items-center justify-between rounded-xl border border-brand-300 bg-brand-50 px-3.5 py-2.5">
                <span className="text-sm text-navy-800">
                  Store <span className="font-mono font-semibold">{form.storeId}</span>
                </span>
                <button type="button" onClick={() => { setForm((f) => ({ ...f, storeId: "" })); setStoreQuery(""); }}
                  className="text-xs font-semibold text-navy-600 hover:text-navy-900">
                  Remove
                </button>
              </div>
            ) : (
              <>
                <input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)}
                  placeholder="Search by name or Store ID…"
                  className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
                {storeHits.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-navy-200">
                    {storeHits.map((s) => (
                      <li key={s.storeId}>
                        <button type="button"
                          onClick={() => { setForm((f) => ({ ...f, storeId: s.storeId })); setStoreHits([]); }}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50">
                          <span className="truncate">{s.restaurantName}</span>
                          <span className="shrink-0 font-mono text-xs text-navy-500">{s.storeId}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Priority
              </span>
              <select name="priority" value={form.priority} onChange={set}
                className="w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500">
                {["low", "normal", "high", "urgent"].map((p) => (
                  <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Deadline
              </span>
              <input type="date" name="deadline" value={form.deadline} onChange={set}
                className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
              Assign to
            </span>
            <select name="assignedToId" value={form.assignedToId} onChange={set}
              className="w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500">
              <option value="">Leave unassigned</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName} ({a.staffId}){a.id === staff?.id ? " — me" : ""}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
              Cancel
            </button>
            <button type="submit" disabled={busy || form.title.trim().length < 3}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "Creating…" : "Create job"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JobCreateDialog;
