import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FiPlus, FiChevronLeft, FiChevronRight, FiAlertCircle } from "react-icons/fi";
import { jobs as jobsApi, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import PriorityBadge from "../components/PriorityBadge";
import JobCreateDialog from "../components/JobCreateDialog";
import { useAuth } from "../context/AuthContext";
import { dOnly as dt } from "../lib/format";


/** A deadline in the past on an unfinished job needs to be obvious. */
const isOverdue = (job) =>
  job.deadline && job.status !== "closed" && new Date(job.deadline) < new Date();

const Jobs = () => {
  const { staff } = useAuth();
  const [filters, setFilters] = useState({ status: "", priority: "", mine: false, q: "" });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async (page = 1) => {
      setBusy(true);
      setError("");
      try {
        const params = { page, limit: 25 };
        if (filters.status) params.status = filters.status;
        if (filters.priority) params.priority = filters.priority;
        if (filters.mine) params.mine = "true";
        if (filters.q.trim()) params.q = filters.q.trim();
        setData(await jobsApi.list(params));
      } catch (err) {
        setError(errorMessage(err, "Could not load jobs."));
      } finally {
        setBusy(false);
      }
    },
    [filters]
  );

  useEffect(() => {
    const t = setTimeout(() => load(1), 250);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Jobs</h1>
          <p className="mt-1 text-sm text-navy-500">
            Internal tasks. Closed jobs are kept permanently as the record of work done.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500"
        >
          <FiPlus aria-hidden="true" /> New job
        </button>
      </header>

      <div className="flex flex-wrap gap-3 rounded-2xl border border-navy-200 bg-white p-4">
        <input
          value={filters.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Search title, description or job ID…"
          aria-label="Search jobs"
          className="min-w-[14rem] flex-1 rounded-xl border border-navy-200 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <select value={filters.status} onChange={(e) => set("status", e.target.value)}
          aria-label="Filter by status"
          className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filters.priority} onChange={(e) => set("priority", e.target.value)}
          aria-label="Filter by priority"
          className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500">
          <option value="">All priorities</option>
          {["urgent", "high", "normal", "low"].map((p) => (
            <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-navy-200 px-3 py-2 text-sm text-navy-700">
          <input type="checkbox" checked={filters.mine} onChange={(e) => set("mine", e.target.checked)}
            className="h-4 w-4 rounded border-navy-300 text-brand-600" />
          Assigned to me
        </label>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {busy && !data && <p className="mt-6 text-sm text-navy-500">Loading jobs…</p>}

      {data && data.results.length === 0 && (
        <p className="mt-6 rounded-2xl border border-navy-200 bg-white p-8 text-center text-sm text-navy-500">
          No jobs match these filters.
        </p>
      )}

      {data && data.results.length > 0 && (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-200 bg-white">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Job</th>
                  <th scope="col" className="px-4 py-3">Title</th>
                  <th scope="col" className="px-4 py-3">Restaurant</th>
                  <th scope="col" className="px-4 py-3">Assigned to</th>
                  <th scope="col" className="px-4 py-3">Priority</th>
                  <th scope="col" className="px-4 py-3">Deadline</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((j) => (
                  <tr key={j.id} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                    <td className="px-4 py-3">
                      <Link to={`/jobs/${j.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-700">
                        {j.jobId}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/jobs/${j.id}`} className="font-medium text-navy-900 hover:text-brand-700">
                        {j.title}
                      </Link>
                      {j.commentCount > 0 && (
                        <span className="ml-2 text-xs text-navy-400">{j.commentCount} comment{j.commentCount > 1 ? "s" : ""}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-navy-700">
                      {j.storeId ? (
                        <>
                          <div>{j.restaurantName || "—"}</div>
                          <div className="font-mono text-xs text-navy-400">{j.storeId}</div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-navy-700">
                      {j.assignedTo
                        ? <>{j.assignedTo.name}{j.assignedTo.id === staff?.id && <span className="text-brand-600"> (you)</span>}</>
                        : <span className="text-navy-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3"><PriorityBadge priority={j.priority} /></td>
                    <td className="px-4 py-3">
                      {j.deadline ? (
                        <span className={isOverdue(j) ? "inline-flex items-center gap-1 font-medium text-red-600" : "text-navy-600"}>
                          {isOverdue(j) && <FiAlertCircle size={12} aria-hidden="true" />}
                          {dt(j.deadline)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" disabled={data.page <= 1 || busy} onClick={() => load(data.page - 1)}
                className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
                <FiChevronLeft />
              </button>
              <span className="text-sm text-navy-600">{data.page} / {data.pages}</span>
              <button type="button" disabled={data.page >= data.pages || busy} onClick={() => load(data.page + 1)}
                className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
                <FiChevronRight />
              </button>
            </div>
          )}
        </>
      )}

      {creating && (
        <JobCreateDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(1); }} />
      )}
    </div>
  );
};

export default Jobs;
