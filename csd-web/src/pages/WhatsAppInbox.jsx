import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FiSearch, FiSend, FiX, FiPlus, FiCheck, FiClock, FiAlertCircle, FiArrowLeft,
  FiEdit2, FiFileText, FiPaperclip, FiLock, FiUser, FiShoppingBag,
} from "react-icons/fi";
import { whatsapp, jobs, errorMessage } from "../api";
import { useAuth } from "../context/AuthContext";

/**
 * CSD → Chat → WhatsApp: the support number's WhatsApp, as a team inbox.
 *
 * Polls rather than using a socket, for the same reason the internal chat
 * does (CSD is not on the POS socket): every few seconds is live enough for
 * support, and each poll is one indexed query.
 */
const POLL_MS = 4000;

const time = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" });
const when = (d) => {
  if (!d) return "";
  const t = new Date(d);
  const now = new Date();
  if (t.toDateString() === now.toDateString()) return time(t);
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (t.toDateString() === y.toDateString()) return "Yesterday";
  return t.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
const left = (d) => {
  const ms = new Date(d).getTime() - Date.now();
  if (ms <= 0) return "";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const pretty = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`;
};
const initials = (c) => {
  const n = (c.name || "").trim();
  if (!n) return String(c.waId || "").slice(-2);
  return n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
};

const FILTERS = [
  { key: "open", label: "Open", count: "open" },
  { key: "unread", label: "Unread", count: "unread" },
  { key: "mine", label: "Mine", count: "mine" },
  { key: "unassigned", label: "Unassigned", count: "unassigned" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

const Ticks = ({ status, error }) => {
  if (status === "pending") return <FiClock size={11} aria-label="Sending" />;
  if (status === "failed") return <FiAlertCircle size={12} className="text-red-500" aria-label={`Not sent: ${error}`} />;
  if (status === "sent") return <FiCheck size={12} aria-label="Sent" />;
  const read = status === "read";
  return (
    <span className={`inline-flex ${read ? "text-sky-500" : ""}`} aria-label={read ? "Read" : "Delivered"}>
      <FiCheck size={12} /><FiCheck size={12} className="-ml-[7px]" />
    </span>
  );
};

/* ------------------------------------------------------------ templates */

const TemplatePicker = ({ templates, loading, error, value, onChange }) => {
  const tpl = templates.find((t) => `${t.name}|${t.language}` === value.key);
  const filled = tpl ? [tpl.header, tpl.body, tpl.footer].filter(Boolean).join("\n\n")
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => value.values[k] || m) : "";
  return (
    <div className="space-y-3">
      {loading && <p className="text-sm text-navy-500">Loading approved templates…</p>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!loading && !error && templates.length === 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          No approved templates on the WhatsApp account yet. Create one in the provider’s panel and wait for WhatsApp to approve it.
        </p>
      )}
      {templates.length > 0 && (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Template</span>
          <select value={value.key} onChange={(e) => onChange({ key: e.target.value, values: {} })}
            className="w-full rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500">
            <option value="">Choose a template…</option>
            {templates.map((t) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`} disabled={!t.supported}>
                {t.name} ({t.language}){t.supported ? "" : " — needs a picture or link"}
              </option>
            ))}
          </select>
        </label>
      )}
      {tpl && tpl.variables.map((v) => (
        <label key={v} className="block">
          <span className="mb-1 block text-xs font-medium text-navy-600">{`{{${v}}}`}</span>
          <input value={value.values[v] || ""} maxLength={1000}
            onChange={(e) => onChange({ ...value, values: { ...value.values, [v]: e.target.value } })}
            className="w-full rounded-xl border border-navy-200 px-3.5 py-2 text-sm outline-none focus:border-brand-500" />
        </label>
      ))}
      {tpl && (
        <div className="rounded-xl bg-[#e7f6e1] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-800">Preview</div>
          <div className="whitespace-pre-wrap text-sm text-navy-900">{filled}</div>
        </div>
      )}
    </div>
  );
};

const useTemplates = (enabled) => {
  const [state, setState] = useState({ list: [], loading: false, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    whatsapp.templates()
      .then((list) => alive && setState({ list, loading: false, error: "" }))
      .catch((err) => alive && setState({ list: [], loading: false, error: errorMessage(err, "Could not load templates.") }));
    return () => { alive = false; };
  }, [enabled]);
  return state;
};

const templatePayload = (templates, value) => {
  const tpl = templates.find((t) => `${t.name}|${t.language}` === value.key);
  if (!tpl) return null;
  return { name: tpl.name, language: tpl.language, values: value.values };
};
const templateReady = (templates, value) => {
  const tpl = templates.find((t) => `${t.name}|${t.language}` === value.key);
  return !!tpl && tpl.variables.every((v) => String(value.values[v] || "").trim());
};

const Modal = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
    <div role="dialog" aria-modal="true" aria-label={title} className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold text-navy-900">{title}</h2>
        <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close"><FiX size={20} /></button>
      </div>
      {children}
    </div>
  </div>
);

const NewChatDialog = ({ onClose, onStarted }) => {
  const { list, loading, error: tplError } = useTemplates(true);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [tpl, setTpl] = useState({ key: "", values: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await whatsapp.start({ phone, name, template: templatePayload(list, tpl) });
      onStarted(r.conversationId);
    } catch (err) {
      setError(errorMessage(err, "Could not send the message."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New WhatsApp chat" onClose={onClose}>
      <p className="mb-4 text-sm text-navy-500">
        WhatsApp only lets a business start a chat with an approved template. Once the customer replies, you can write freely for 24 hours.
      </p>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">WhatsApp number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" autoComplete="off"
              placeholder="98765 43210 or +44…"
              className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoComplete="off"
              className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          </label>
        </div>
        <TemplatePicker templates={list} loading={loading} error={tplError} value={tpl} onChange={setTpl} />
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
          <button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10 || !templateReady(list, tpl)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const TemplateDialog = ({ onClose, onSend }) => {
  const { list, loading, error: tplError } = useTemplates(true);
  const [tpl, setTpl] = useState({ key: "", values: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSend(templatePayload(list, tpl));
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Could not send the template."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Send a template" onClose={onClose}>
      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <form onSubmit={submit} className="space-y-4">
        <TemplatePicker templates={list} loading={loading} error={tplError} value={tpl} onChange={setTpl} />
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
          <button type="submit" disabled={busy || !templateReady(list, tpl)}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
            {busy ? "Sending…" : "Send template"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

/* -------------------------------------------------------------- not set up */

const NotConnected = ({ status, isAdmin }) => (
  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
    <p className="font-semibold">WhatsApp is not connected yet.</p>
    <p className="mt-1">
      Customer chats on the support number will appear here once the server has the WhatsApp API details.
      {isAdmin ? "" : " Ask an admin to connect it."}
    </p>
    {isAdmin && status?.webhooks && (
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-900/90">
        <li>Heyo is app-only; the support number’s WhatsApp API is MyOperator’s (Heyo’s parent company). Get API access on the number (MyOperator panel → API &amp; Webhook → WhatsApp APIs).</li>
        <li>Put <code>WHATSAPP_PROVIDER=myoperator</code>, the API key, company id, phone number id and a random <code>WHATSAPP_WEBHOOK_TOKEN</code> in the server’s <code>.env</code> (see <code>deploy/.env.production.example</code>).</li>
        <li>In MyOperator, send the message.received / sent / delivered / read / failed webhooks to <code>https://api.knotkitchen.com{status.webhooks.myoperator}</code>.</li>
      </ol>
    )}
  </div>
);

/* ------------------------------------------------------------------- inbox */

const WhatsAppInbox = ({ onUnread }) => {
  const { staff, isAdmin } = useAuth();
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState("open");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [list, setList] = useState({ conversations: [], counts: {} });
  const [listLoaded, setListLoaded] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);
  const [older, setOlder] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("reply"); // reply | note
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [staffList, setStaffList] = useState([]);
  const [newChat, setNewChat] = useState(false);
  const [templateFor, setTemplateFor] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const bottomRef = useRef(null);
  const scrollRef = useRef(null);
  const lastIdRef = useRef(null);
  const activeRef = useRef(null);
  const olderRef = useRef([]);
  activeRef.current = activeId;
  olderRef.current = older;

  useEffect(() => {
    whatsapp.status().then(setStatus).catch(() => setStatus({ configured: false }));
    jobs.assignees().then(setStaffList).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadList = useCallback(async () => {
    try {
      const data = await whatsapp.conversations({ filter, q: query || undefined });
      setList(data);
      setListLoaded(true);
      onUnread?.(data.counts?.unread || 0);
    } catch (err) {
      setError(errorMessage(err, "Could not load WhatsApp chats."));
    }
  }, [filter, query, onUnread]);

  const loadListRef = useRef(loadList);
  loadListRef.current = loadList;

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, POLL_MS);
    return () => clearInterval(t);
  }, [loadList]);

  const loadThread = useCallback(async (id, { scroll = false } = {}) => {
    if (!id) return;
    try {
      // A chat open in a background tab has not been read by anyone.
      const data = await whatsapp.messages(id, { limit: 60, markRead: document.hidden ? "0" : undefined });
      if (activeRef.current !== id) return; // switched chats while this was loading
      const lastNew = data.messages[data.messages.length - 1]?.id;
      const grew = lastIdRef.current !== null && lastNew !== lastIdRef.current;
      lastIdRef.current = lastNew || "";
      const el = scrollRef.current;
      const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setThread(data);
      if (!olderRef.current.length) setHasMore(data.hasMore);
      if (scroll || (grew && atBottom)) setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 30);
    } catch (err) {
      setError(errorMessage(err, "Could not load the chat."));
    }
  }, []);

  useEffect(() => {
    setOlder([]);
    olderRef.current = [];
    setThread(null);
    setHasMore(false);
    lastIdRef.current = null;
    if (!activeId) return undefined;
    // Opening it read it: refresh the list so its unread badge goes now.
    loadThread(activeId, { scroll: true }).then(() => loadListRef.current());
    const t = setInterval(() => loadThread(activeId), POLL_MS);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  const loadOlder = async () => {
    const first = (older[0] || thread?.messages[0]);
    if (!first) return;
    const el = scrollRef.current;
    const before = el ? el.scrollHeight : 0;
    try {
      const data = await whatsapp.messages(activeId, { limit: 60, before: first.at, markRead: "0" });
      setOlder((o) => [...data.messages, ...o]);
      setHasMore(data.hasMore);
      setTimeout(() => { if (el) el.scrollTop = el.scrollHeight - before; }, 0);
    } catch (err) {
      setError(errorMessage(err, "Could not load earlier messages."));
    }
  };

  const conv = thread?.conversation;
  const messages = useMemo(() => {
    const seen = new Set();
    return [...older, ...(thread?.messages || [])].filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  }, [older, thread]);

  const refresh = async () => { await loadThread(activeId, { scroll: true }); loadList(); };

  const send = async (e) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending || !conv) return;
    setSending(true);
    setError("");
    setDraft("");
    try {
      await whatsapp.send(conv.id, mode === "note" ? { note: true, text } : { text });
    } catch (err) {
      setError(errorMessage(err, "Could not send the message."));
      if (err?.response?.data?.code === "WHATSAPP_WINDOW_CLOSED" || err?.response?.status === 400) setDraft(text);
    } finally {
      setSending(false);
      refresh();
    }
  };

  const update = async (payload) => {
    try {
      await whatsapp.update(conv.id, payload);
      refresh();
    } catch (err) {
      setError(errorMessage(err, "Could not update the chat."));
    }
  };

  const configured = status ? status.configured : true;
  const replyBlocked = mode === "reply" && conv && !conv.windowOpen;
  let lastDay = null;

  return (
    <div>
      {status && !status.configured && <NotConnected status={status} isAdmin={isAdmin} />}
      {error && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="shrink-0"><FiX /></button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        {/* Conversation list */}
        <aside className={`min-w-0 flex-col rounded-2xl border border-navy-200 bg-white ${activeId ? "hidden lg:flex" : "flex"}`}>
          <div className="space-y-2.5 border-b border-navy-100 p-3">
            <div className="flex gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl border border-navy-200 px-3 py-2">
                <FiSearch className="shrink-0 text-navy-400" aria-hidden="true" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or number…"
                  aria-label="Search WhatsApp chats" className="w-full bg-transparent text-sm outline-none" />
              </div>
              <button type="button" onClick={() => setNewChat(true)} disabled={!configured}
                title={configured ? "New WhatsApp chat" : "WhatsApp is not connected yet"}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                <FiPlus aria-hidden="true" /> New
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter chats">
              {FILTERS.map((f) => {
                const n = f.count ? list.counts?.[f.count] || 0 : 0;
                const on = filter === f.key;
                return (
                  <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${on ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-600 hover:bg-navy-100"}`}>
                    {f.label}{f.count && n > 0 ? <span className={`ml-1 ${on ? "text-white/70" : "text-navy-400"}`}>{n}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <ul className="max-h-[36rem] min-h-[12rem] flex-1 overflow-y-auto">
            {listLoaded && list.conversations.length === 0 && (
              <li className="p-6 text-center text-sm text-navy-500">
                {query ? "No chats match." : filter === "open" ? "No open WhatsApp chats." : "Nothing here."}
              </li>
            )}
            {list.conversations.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setActiveId(c.id)}
                  className={`flex w-full gap-3 border-b border-navy-100 p-3 text-left last:border-b-0 ${c.id === activeId ? "bg-emerald-50" : "hover:bg-navy-50"}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">
                    {initials(c)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? "font-bold" : "font-semibold"} text-navy-900`}>{c.name || pretty(c.waId)}</span>
                      <span className={`shrink-0 text-[11px] ${c.unread ? "font-semibold text-emerald-600" : "text-navy-400"}`}>{when(c.lastMessageAt)}</span>
                    </span>
                    {c.name && <span className="block text-[11px] text-navy-400">{pretty(c.waId)}</span>}
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.unread ? "text-navy-800" : "text-navy-500"}`}>
                        {c.lastMessageDirection === "out" && <span className="text-navy-400">You: </span>}
                        {c.lastMessagePreview || "—"}
                      </span>
                      {c.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unread}</span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                      {c.assignedTo ? (
                        <span className={`rounded px-1.5 py-0.5 ${c.assignedToMe ? "bg-brand-50 text-brand-700" : "bg-navy-50 text-navy-600"}`}>
                          {c.assignedToMe ? "You" : c.assignedTo.name}
                        </span>
                      ) : c.status === "open" ? (
                        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">Unassigned</span>
                      ) : null}
                      {c.status === "closed" && <span className="rounded bg-navy-100 px-1.5 py-0.5 text-navy-500">Closed</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Thread */}
        <section className={`min-h-[34rem] min-w-0 flex-col rounded-2xl border border-navy-200 bg-white ${activeId ? "flex" : "hidden lg:flex"}`}>
          {!conv ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-navy-500">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><FiSend aria-hidden="true" /></span>
              {activeId ? "Loading…" : "Pick a chat to read and reply."}
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-navy-200 p-3 sm:p-4">
                <button type="button" onClick={() => setActiveId(null)} className="rounded-lg p-1.5 text-navy-500 hover:bg-navy-50 lg:hidden" aria-label="Back to chats">
                  <FiArrowLeft />
                </button>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-800">{initials(conv)}</span>
                <div className="min-w-0 flex-1">
                  {editingName !== null ? (
                    <form onSubmit={(e) => { e.preventDefault(); update({ customName: editingName }); setEditingName(null); }} className="flex gap-2">
                      <input autoFocus value={editingName} onChange={(e) => setEditingName(e.target.value)} maxLength={200}
                        placeholder={conv.profileName || "Name"} aria-label="Customer name"
                        className="w-full max-w-xs rounded-lg border border-navy-200 px-2.5 py-1 text-sm outline-none focus:border-brand-500" />
                      <button type="submit" className="text-xs font-semibold text-brand-600">Save</button>
                      <button type="button" onClick={() => setEditingName(null)} className="text-xs text-navy-500">Cancel</button>
                    </form>
                  ) : (
                    <h2 className="flex items-center gap-1.5 truncate font-bold text-navy-900">
                      <span className="truncate">{conv.name || pretty(conv.waId)}</span>
                      <button type="button" onClick={() => setEditingName(conv.customName || conv.profileName || "")}
                        className="text-navy-400 hover:text-navy-700" aria-label="Edit name"><FiEdit2 size={13} /></button>
                    </h2>
                  )}
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-navy-500">
                    <a href={`https://wa.me/${conv.waId}`} target="_blank" rel="noreferrer" className="hover:text-navy-800">{pretty(conv.waId)}</a>
                    {conv.profileName && conv.customName && <span>· WhatsApp name “{conv.profileName}”</span>}
                    {(conv.stores || []).map((s) => (
                      <Link key={s.storeId} to={`/stores/${s.storeId}`} className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700">
                        <FiShoppingBag size={11} aria-hidden="true" /> {s.storeName} · {s.storeId}
                      </Link>
                    ))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 rounded-xl border border-navy-200 px-2.5 py-1.5 text-xs">
                    <FiUser className="text-navy-400" aria-hidden="true" />
                    <span className="sr-only">Assigned to</span>
                    <select value={conv.assignedTo?.id || ""} onChange={(e) => update({ assignedTo: e.target.value || null })}
                      className="max-w-[10rem] bg-transparent text-xs font-semibold text-navy-800 outline-none">
                      <option value="">Unassigned</option>
                      {staffList.map((s) => (
                        <option key={s.id} value={s.id}>{s.id === String(staff?.id || staff?._id) ? `${s.fullName} (you)` : s.fullName}</option>
                      ))}
                    </select>
                  </label>
                  {!conv.assignedToMe && (
                    <button type="button" onClick={() => update({ assignedTo: "me" })}
                      className="rounded-xl border border-navy-200 px-2.5 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50">Take it</button>
                  )}
                  <button type="button" onClick={() => update({ status: conv.status === "open" ? "closed" : "open" })}
                    className={`rounded-xl px-2.5 py-1.5 text-xs font-semibold ${conv.status === "open" ? "bg-navy-900 text-white hover:bg-navy-700" : "border border-navy-200 text-navy-700 hover:bg-navy-50"}`}>
                    {conv.status === "open" ? "Close chat" : "Re-open"}
                  </button>
                </div>
              </header>

              {conv.assignedTo && !conv.assignedToMe && conv.status === "open" && (
                <p className="border-b border-navy-100 bg-navy-50 px-4 py-1.5 text-xs text-navy-600">
                  {conv.assignedTo.name} is handling this chat. You can still reply.
                </p>
              )}

              <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto bg-[#f4f1ec] p-4" style={{ maxHeight: "30rem" }}>
                {hasMore && (
                  <div className="text-center">
                    <button type="button" onClick={loadOlder} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-navy-600 shadow-sm hover:text-navy-900">
                      Load earlier messages
                    </button>
                  </div>
                )}
                {messages.length === 0 && <p className="py-8 text-center text-sm text-navy-400">No messages yet.</p>}
                {messages.map((m) => {
                  const d = day(m.at);
                  const showDay = d !== lastDay;
                  lastDay = d;
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && (
                        <div className="py-1 text-center">
                          <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-medium text-navy-500 shadow-sm">{d}</span>
                        </div>
                      )}
                      {m.direction === "event" ? (
                        <p className="py-0.5 text-center text-[11px] text-navy-500">{m.body} · {time(m.at)}</p>
                      ) : m.direction === "note" ? (
                        <div className="mx-auto max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2">
                          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-amber-800">
                            <FiLock size={10} aria-hidden="true" /> Internal note · {m.staffName}
                          </div>
                          <div className="whitespace-pre-wrap text-sm text-navy-900">{m.body}</div>
                          <div className="mt-0.5 text-right text-[10px] text-amber-700/70">{time(m.at)}</div>
                        </div>
                      ) : (
                        <div className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm ${
                            m.direction === "out" ? (m.status === "failed" ? "bg-red-50 ring-1 ring-red-200" : "bg-[#d9fdd3]") : "bg-white"
                          }`}>
                            {m.direction === "out" && (
                              <div className="mb-0.5 text-[11px] font-semibold text-emerald-800">
                                {m.external ? "Sent from another app" : m.isMine ? "You" : m.staffName}
                                {m.template && <span className="ml-1.5 font-normal text-emerald-700/70">· template {m.template.name}</span>}
                              </div>
                            )}
                            {m.media && (
                              m.media.hasFile ? (
                                m.type === "image" || m.type === "sticker" ? (
                                  <a href={whatsapp.mediaUrl(m.id)} target="_blank" rel="noreferrer" className="mb-1 block">
                                    <img src={whatsapp.mediaUrl(m.id)} alt={m.body || "Photo from the customer"} loading="lazy"
                                      className="max-h-64 rounded-lg object-contain" />
                                  </a>
                                ) : (
                                  <a href={whatsapp.mediaUrl(m.id)} target="_blank" rel="noreferrer"
                                    className="mb-1 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-xs font-semibold text-navy-800 hover:bg-black/10">
                                    <FiPaperclip aria-hidden="true" /> {m.media.filename || `Open ${m.type}`}
                                  </a>
                                )
                              ) : (
                                <div className="mb-1 flex items-center gap-2 text-xs italic text-navy-500">
                                  <FiPaperclip aria-hidden="true" /> {m.media.filename || m.type} (open it in WhatsApp)
                                </div>
                              )
                            )}
                            {m.body && <div className="whitespace-pre-wrap break-words text-sm text-navy-900">{m.body}</div>}
                            {m.status === "failed" && <div className="mt-1 text-xs text-red-600">Not sent: {m.error || "WhatsApp refused it."}</div>}
                            <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-navy-400">
                              {time(m.at)}
                              {m.direction === "out" && <Ticks status={m.status} error={m.error} />}
                            </div>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={send} className="border-t border-navy-200 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex gap-1" role="tablist" aria-label="Message type">
                    {[{ k: "reply", l: "Reply" }, { k: "note", l: "Internal note" }].map(({ k, l }) => (
                      <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${mode === k ? (k === "note" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900") : "text-navy-500 hover:bg-navy-50"}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {mode === "reply" && (
                    <span className={`text-[11px] ${conv.windowOpen ? "text-navy-400" : "font-semibold text-amber-700"}`}>
                      {conv.windowOpen ? `Reply window closes in ${left(conv.windowClosesAt)}` : "24-hour window closed: send a template"}
                    </span>
                  )}
                </div>
                {replyBlocked ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                    <span>
                      {conv.windowClosesAt ? "The customer last wrote over 24 hours ago." : "The customer has not written yet."}{" "}
                      WhatsApp only allows an approved template until they reply.
                    </span>
                    <button type="button" onClick={() => setTemplateFor(true)} disabled={!configured}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
                      <FiFileText aria-hidden="true" /> Send a template
                    </button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                      maxLength={mode === "note" ? 4000 : 4096}
                      placeholder={mode === "note" ? "A note for the team (the customer never sees it)…" : "Type a WhatsApp reply…"}
                      aria-label={mode === "note" ? "Internal note" : "WhatsApp reply"}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
                      className={`flex-1 resize-none rounded-xl border px-3.5 py-2.5 text-sm outline-none ${mode === "note" ? "border-amber-200 bg-amber-50/40 focus:border-amber-400" : "border-navy-200 focus:border-emerald-500"}`} />
                    {mode === "reply" && (
                      <button type="button" onClick={() => setTemplateFor(true)} disabled={!configured} title="Send a template"
                        className="rounded-xl border border-navy-200 p-2.5 text-navy-500 hover:bg-navy-50 disabled:opacity-40" aria-label="Send a template">
                        <FiFileText />
                      </button>
                    )}
                    <button type="submit" disabled={sending || !draft.trim() || (mode === "reply" && !configured)}
                      className={`rounded-xl p-2.5 text-white disabled:opacity-50 ${mode === "note" ? "bg-amber-500 hover:bg-amber-400" : "bg-emerald-600 hover:bg-emerald-500"}`}
                      aria-label={mode === "note" ? "Add note" : "Send reply"}>
                      <FiSend />
                    </button>
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-navy-400">Enter sends · Shift+Enter for a new line</p>
              </form>
            </>
          )}
        </section>
      </div>

      {newChat && (
        <NewChatDialog onClose={() => setNewChat(false)}
          onStarted={(id) => { setNewChat(false); setFilter("open"); setActiveId(id); loadList(); }} />
      )}
      {templateFor && conv && (
        <TemplateDialog onClose={() => setTemplateFor(false)}
          onSend={async (template) => { await whatsapp.send(conv.id, { template }); refresh(); }} />
      )}
    </div>
  );
};

export default WhatsAppInbox;
