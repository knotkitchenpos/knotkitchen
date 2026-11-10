import React, { useCallback, useEffect, useState } from "react";
import { FiPlus, FiSearch, FiX, FiZap } from "react-icons/fi";
import { knowledge as kbApi, errorMessage, fieldErrors } from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * Knowledge base: internal how-to articles. An article with a quick reply can
 * be inserted in the WhatsApp composer by typing "/", and AI suggestions draw
 * on what is written here.
 */
const EMPTY = { title: "", category: "General", body: "", quickReply: "", shortcut: "" };

const inputClass = (bad) => `w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none ${bad ? "border-red-400" : "border-navy-200 focus:border-brand-500"}`;

const Label = ({ text, error, hint, children }) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">{text}</span>
    {children}
    {hint && !error && <span className="mt-1 block text-xs text-navy-500">{hint}</span>}
    {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
  </label>
);

const Editor = ({ article, categories, onClose, onSaved, canArchive }) => {
  const [form, setForm] = useState(article ? { ...EMPTY, ...article } : EMPTY);
  const [errors, setErrors] = useState({});
  const [banner, setBanner] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: undefined })); };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setBanner("");
    setErrors({});
    try {
      const payload = { title: form.title, category: form.category, body: form.body, quickReply: form.quickReply, shortcut: form.shortcut };
      if (article) await kbApi.update(article.id, payload);
      else await kbApi.create(payload);
      onSaved();
    } catch (err) {
      const fe = fieldErrors(err);
      setErrors(fe);
      setBanner(Object.keys(fe).length ? "" : errorMessage(err, "Could not save."));
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!window.confirm(`Archive "${article.title}"? It stops appearing in search, quick replies and AI suggestions.`)) return;
    setBusy(true);
    try {
      await kbApi.archive(article.id);
      onSaved();
    } catch (err) {
      setBanner(errorMessage(err, "Could not archive."));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-label={article ? "Edit article" : "New article"} className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy-900">{article ? "Edit article" : "New article"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-navy-400 hover:text-navy-700"><FiX size={20} /></button>
        </div>
        {banner && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{banner}</p>}
        <form onSubmit={save} className="space-y-4">
          <Label text="Title" error={errors.title}>
            <input value={form.title} onChange={set("title")} maxLength={200} className={inputClass(errors.title)} placeholder="e.g. KOT printer not printing" />
          </Label>
          <Label text="Category" error={errors.category}>
            <input value={form.category} onChange={set("category")} maxLength={60} list="kb-categories" className={inputClass(errors.category)} />
            <datalist id="kb-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Label>
          <Label text="How-to (for the team)" error={errors.body}>
            <textarea value={form.body} onChange={set("body")} rows={8} maxLength={20000} className={inputClass(errors.body)} placeholder="The steps, what to check, who to ask." />
          </Label>
          <Label text="Quick reply (sent to customers)" error={errors.quickReply} hint="Optional. The ready answer agents can insert in WhatsApp.">
            <textarea value={form.quickReply} onChange={set("quickReply")} rows={4} maxLength={4000} className={inputClass(errors.quickReply)} />
          </Label>
          <Label text="Shortcut" error={errors.shortcut} hint="Optional. Agents type / and this word, like /printer.">
            <input value={form.shortcut} onChange={set("shortcut")} maxLength={40} className={inputClass(errors.shortcut)} placeholder="printer" />
          </Label>
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            {article && canArchive ? (
              <button type="button" onClick={archive} disabled={busy} className="text-sm font-semibold text-red-600 hover:text-red-700">Archive</button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

const Knowledge = () => {
  const { isAdmin } = useAuth();
  const [data, setData] = useState({ articles: [], categories: [] });
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(undefined); // undefined closed, null new, object edit
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await kbApi.list({ q: q.trim() || undefined, category: category || undefined }));
      setLoaded(true);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not load articles."));
    }
  }, [q, category]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Knowledge base</h1>
          <p className="mt-1 text-sm text-navy-500">How-to articles for the team. Quick replies appear in WhatsApp when you type /.</p>
        </div>
        <button type="button" onClick={() => setEditing(null)} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
          <FiPlus aria-hidden="true" /> New article
        </button>
      </header>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex min-w-[14rem] flex-1 items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 py-2">
          <FiSearch className="shrink-0 text-navy-400" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search articles…" aria-label="Search articles" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="rounded-xl border border-navy-200 bg-white px-3 py-2 text-sm outline-none">
          <option value="">All categories</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-navy-200 bg-white">
        {loaded && data.articles.length === 0 && (
          <p className="p-8 text-center text-sm text-navy-500">{q || category ? "No articles match." : "No articles yet. Add the answers your team gives most often."}</p>
        )}
        <ul>
          {data.articles.map((a) => (
            <li key={a.id} className="border-b border-navy-100 last:border-b-0">
              <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} aria-expanded={openId === a.id} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-navy-50">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-navy-900">{a.title}</span>
                  <span className="text-xs text-navy-500">{a.category}</span>
                </span>
                {a.shortcut ? (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-xs text-emerald-800"><FiZap size={11} aria-hidden="true" />/{a.shortcut}</span>
                ) : a.quickReply ? (
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Quick reply</span>
                ) : null}
              </button>
              {openId === a.id && (
                <div className="space-y-3 px-4 pb-4 text-sm">
                  {a.body && <p className="whitespace-pre-wrap text-navy-800">{a.body}</p>}
                  {a.quickReply && (
                    <div className="rounded-xl bg-[#e7f6e1] p-3">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-800">Quick reply</div>
                      <p className="whitespace-pre-wrap text-navy-900">{a.quickReply}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-navy-400">{a.updatedByName ? `Last edited by ${a.updatedByName}` : ""}</span>
                    <button type="button" onClick={() => setEditing(a)} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Edit</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {editing !== undefined && (
        <Editor article={editing} categories={data.categories} canArchive={isAdmin}
          onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); load(); }} />
      )}
    </div>
  );
};

export default Knowledge;
