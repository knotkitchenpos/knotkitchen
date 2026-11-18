import React, { useCallback, useEffect, useState } from "react";
import { announcements as annApi, errorMessage } from "../api";

/**
 * Announcements (owner, 2026-11-17): a banner on every POS, at once. Admins
 * only (server: requireCsdAdmin). All stores, or a list of Store IDs.
 */

const LEVELS = [
  ["info", "Info (blue)"],
  ["warning", "Warning (amber)"],
  ["critical", "Critical (red)"],
];
const input = "w-full rounded-xl border border-navy-200 px-3 py-2 text-sm";
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
const isLive = (a, now = Date.now()) => new Date(a.startsAt).getTime() <= now && (!a.endsAt || new Date(a.endsAt).getTime() > now);

const Field = ({ text, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">{text}</span>
    {children}
    {hint && <span className="mt-1 block text-xs text-navy-500">{hint}</span>}
  </label>
);

const EMPTY = { title: "", body: "", level: "info", linkUrl: "", linkLabel: "", storeIds: "", startsAt: "", endsAt: "" };

const Announcements = () => {
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => annApi.list().then(setRows).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => {
    load();
  }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const post = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await annApi.create({ ...form, startsAt: form.startsAt || null, endsAt: form.endsAt || null });
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const end = async (a) => {
    if (!window.confirm(`Take "${a.title}" off every POS now?`)) return;
    try {
      await annApi.end(a.id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Announcements</h1>
        <p className="text-sm text-navy-500">A banner on every POS, shown at once. Use it for new features, planned downtime or notices.</p>
      </div>

      <form onSubmit={post} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <Field text="Title">
          <input className={input} value={form.title} onChange={set("title")} maxLength={120} placeholder="e.g. Planned maintenance tonight 2–3 AM" required />
        </Field>
        <Field text="Message" hint="Optional, up to 600 characters.">
          <textarea className={input} rows={2} value={form.body} onChange={set("body")} maxLength={600} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field text="Level">
            <select className={input} value={form.level} onChange={set("level")}>
              {LEVELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field text="Starts" hint="Blank = now.">
            <input className={input} type="datetime-local" value={form.startsAt} onChange={set("startsAt")} />
          </Field>
          <Field text="Ends" hint="Blank = until you end it.">
            <input className={input} type="datetime-local" value={form.endsAt} onChange={set("endsAt")} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field text="Link (optional)" hint="Must start with https://">
            <input className={input} value={form.linkUrl} onChange={set("linkUrl")} placeholder="https://knotkitchen.com/..." />
          </Field>
          <Field text="Link text">
            <input className={input} value={form.linkLabel} onChange={set("linkLabel")} maxLength={40} placeholder="Read more" />
          </Field>
        </div>
        <Field text="Only these stores" hint="Blank = every store. Otherwise 6-digit Store IDs, separated by commas.">
          <input className={input} value={form.storeIds} onChange={set("storeIds")} placeholder="893146, 586720" />
        </Field>
        <button type="submit" disabled={busy || !form.title.trim()} className="rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Posting…" : "Post announcement"}
        </button>
      </form>

      <div className="rounded-2xl bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-navy-900">Recent</h2>
        {!rows ? (
          <p className="text-sm text-navy-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-navy-500">No announcements yet.</p>
        ) : (
          <ul className="divide-y divide-navy-100">
            {rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-navy-900">
                    {a.title}{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${isLive(a) ? "bg-green-100 text-green-800" : "bg-navy-100 text-navy-600"}`}>{isLive(a) ? "Live" : new Date(a.startsAt) > new Date() ? "Scheduled" : "Ended"}</span>
                  </p>
                  {a.body && <p className="text-sm text-navy-600">{a.body}</p>}
                  <p className="text-xs text-navy-500">
                    {a.level} · {a.storeIds.length ? `stores ${a.storeIds.join(", ")}` : "all stores"} · from {when(a.startsAt)}
                    {a.endsAt ? ` to ${when(a.endsAt)}` : ""} · by {a.createdByName || "—"}
                  </p>
                </div>
                {(isLive(a) || new Date(a.startsAt) > new Date()) && (
                  <button type="button" onClick={() => end(a)} className="rounded-lg border border-navy-200 px-3 py-1.5 text-sm font-semibold text-navy-700">
                    End now
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default Announcements;
