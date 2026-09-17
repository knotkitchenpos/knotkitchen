import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FiArrowLeft, FiClock, FiAlertCircle, FiSend } from "react-icons/fi";
import { jobs as jobsApi, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import PriorityBadge from "../components/PriorityBadge";
import { useAuth } from "../context/AuthContext";
import { dt, dOnly } from "../lib/format";


/** Which statuses can be reached from the current one (mirrors the server). */
const NEXT = {
  open: ["in_progress", "closed"],
  in_progress: ["open", "closed"],
  closed: ["in_progress"],
};
const LABEL = { open: "Reopen", in_progress: "Start work", closed: "Close job" };

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 border-b border-navy-100 py-2.5 last:border-b-0">
    <dt className="text-xs font-semibold uppercase tracking-wider text-navy-500">{label}</dt>
    <dd className="text-right text-sm text-navy-900">{children ?? "—"}</dd>
  </div>
);

const JobDetail = () => {
  const { jobId } = useParams();
  const { staff } = useAuth();
  const [job, setJob] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    jobsApi.get(jobId)
      .then((d) => alive && setJob(d))
      .catch((err) => alive && setError(errorMessage(err, "Could not load this job.")));
    jobsApi.assignees().then((a) => alive && setAssignees(a)).catch(() => {});
    return () => { alive = false; };
  }, [jobId]);

  const act = async (fn, failMsg) => {
    setBusy(true);
    setError("");
    try {
      setJob(await fn());
    } catch (err) {
      setError(errorMessage(err, failMsg));
    } finally {
      setBusy(false);
    }
  };

  const postComment = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await act(() => jobsApi.comment(job.id, comment.trim()), "Could not add the comment.");
    setComment("");
  };

  if (error && !job) {
    return (
      <div className="mx-auto max-w-3xl">
        <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
          <FiArrowLeft aria-hidden="true" /> Back to jobs
        </Link>
        <p className="mt-6 text-sm text-red-600">{error}</p>
      </div>
    );
  }
  if (!job) return <p className="text-sm text-navy-500">Loading job…</p>;

  const overdue = job.deadline && job.status !== "closed" && new Date(job.deadline) < new Date();

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/jobs" className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:text-navy-900">
        <FiArrowLeft aria-hidden="true" /> Back to jobs
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-sm font-semibold text-brand-600">{job.jobId}</span>
            <StatusBadge status={job.status} />
            <PriorityBadge priority={job.priority} />
          </div>
          <h1 className="mt-1.5 text-2xl font-bold text-navy-900">{job.title}</h1>
        </div>

        <div className="flex flex-wrap gap-2">
          {(NEXT[job.status] || []).map((s) => (
            <button key={s} type="button" disabled={busy}
              onClick={() => act(() => jobsApi.setStatus(job.id, s), "Could not change the status.")}
              className={`rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50 ${
                s === "closed"
                  ? "bg-brand-600 text-white hover:bg-brand-500"
                  : "border border-navy-300 bg-white text-navy-700 hover:bg-navy-50"
              }`}>
              {LABEL[s]}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-2xl border border-navy-200 bg-white p-5">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Description</h2>
            <p className="whitespace-pre-wrap text-sm text-navy-800">
              {job.description || <span className="text-navy-400">No description given.</span>}
            </p>
          </section>

          <section className="rounded-2xl border border-navy-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-700">
              Internal notes ({job.comments.length})
            </h2>

            {job.comments.length === 0 && (
              <p className="text-sm text-navy-400">No notes yet.</p>
            )}

            <ul className="space-y-3">
              {job.comments.map((c) => (
                <li key={c.id} className="rounded-xl bg-navy-50 p-3.5">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-navy-900">
                      {c.authorName}
                      <span className="ml-1.5 font-mono text-xs font-normal text-navy-400">{c.authorStaffId}</span>
                    </span>
                    <span className="text-xs text-navy-400">{dt(c.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-navy-800">{c.body}</p>
                </li>
              ))}
            </ul>

            <form onSubmit={postComment} className="mt-4">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={4000}
                placeholder="Add an internal note…"
                className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
              <div className="mt-2 flex justify-end">
                <button type="submit" disabled={busy || !comment.trim()}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
                  <FiSend aria-hidden="true" /> Add note
                </button>
              </div>
            </form>
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-navy-200 bg-white p-5">
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-navy-700">Details</h2>
            <dl>
              <Row label="Restaurant">
                {job.storeId ? (
                  <Link to={`/stores/${job.storeId}`} className="text-brand-600 hover:text-brand-700">
                    {job.restaurantName || job.storeId}
                    <span className="ml-1 font-mono text-xs text-navy-400">{job.storeId}</span>
                  </Link>
                ) : null}
              </Row>
              <Row label="Created by">
                {job.createdBy.name}
                <span className="ml-1 font-mono text-xs text-navy-400">{job.createdBy.staffId}</span>
              </Row>
              <Row label="Created">{dt(job.createdAt)}</Row>
              <Row label="Deadline">
                {job.deadline ? (
                  <span className={overdue ? "inline-flex items-center gap-1 font-medium text-red-600" : ""}>
                    {overdue && <FiAlertCircle size={12} aria-hidden="true" />}
                    {dOnly(job.deadline)}
                  </span>
                ) : null}
              </Row>
              {job.closedAt && (
                <>
                  <Row label="Closed">{dt(job.closedAt)}</Row>
                  <Row label="Closed by">{job.closedByName}</Row>
                </>
              )}
            </dl>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">
                Assigned to
              </span>
              <select
                value={job.assignedTo?.id || ""}
                disabled={busy}
                onChange={(e) =>
                  act(() => jobsApi.update(job.id, { assignedToId: e.target.value || null }),
                    "Could not reassign the job.")}
                className="w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500"
              >
                <option value="">Unassigned</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName} ({a.staffId}){a.id === staff?.id ? " — me" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="rounded-2xl border border-navy-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-navy-700">History</h2>
            <ul className="space-y-3">
              {job.transitions.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-xs">
                  <FiClock className="mt-0.5 shrink-0 text-navy-400" aria-hidden="true" />
                  <span className="text-navy-700">
                    {t.from ? (
                      <>Moved <strong>{t.from.replace("_", " ")}</strong> → <strong>{t.to.replace("_", " ")}</strong></>
                    ) : (
                      <>Created as <strong>{t.to}</strong></>
                    )}
                    <span className="block text-navy-400">{t.byName} · {dt(t.at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default JobDetail;
