import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FiPlus, FiSend, FiSearch, FiX, FiPaperclip, FiHash, FiShoppingBag } from "react-icons/fi";
import { chat, stores as storesApi, errorMessage } from "../api";

const time = (d) => new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const day = (d) => new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" });

/**
 * Poll interval for the open thread.
 *
 * Deliberately polling rather than Socket.IO: the existing socket service
 * authenticates POS tokens against a restaurant tenant, and a CSD session is
 * neither. Wiring a second auth path into it is a change to live POS realtime
 * infrastructure, which is not worth the risk for an internal desk this size.
 * 5s is well within what a support conversation needs, and the endpoint is a
 * single indexed query. Swapping to sockets later needs no client changes
 * beyond replacing this timer.
 */
const POLL_MS = 5000;

const NewConversationDialog = ({ onClose, onCreated }) => {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("group");
  const [storeId, setStoreId] = useState("");
  const [storeQuery, setStoreQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = storeQuery.trim();
    if (q.length < 2) { setHits([]); return undefined; }
    const t = setTimeout(() => {
      storesApi.search({ q, limit: 5 }).then((d) => setHits(d.results)).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [storeQuery]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await chat.createConversation({
        title, type, storeId: type === "store" ? storeId : undefined,
      });
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err, "Could not start the conversation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-navy-900">New conversation</h2>
          <button type="button" onClick={onClose} className="text-navy-400 hover:text-navy-700" aria-label="Close">
            <FiX size={20} />
          </button>
        </div>

        {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2}
              placeholder="e.g. Weekend escalations"
              className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
          </label>

          <div className="grid grid-cols-2 gap-3">
            {[
              { v: "group", label: "Group", help: "General internal channel", Icon: FiHash },
              { v: "store", label: "Store", help: "About one restaurant", Icon: FiShoppingBag },
            ].map(({ v, label, help, Icon }) => (
              <button key={v} type="button" onClick={() => setType(v)}
                className={`rounded-xl border p-3 text-left ${
                  type === v ? "border-brand-500 bg-brand-50" : "border-navy-200 hover:bg-navy-50"
                }`}>
                <Icon className="mb-1 text-navy-600" aria-hidden="true" />
                <span className="block text-sm font-semibold text-navy-900">{label}</span>
                <span className="block text-xs text-navy-500">{help}</span>
              </button>
            ))}
          </div>

          {type === "store" && (
            <div>
              {storeId ? (
                <div className="flex items-center justify-between rounded-xl border border-brand-300 bg-brand-50 px-3.5 py-2.5">
                  <span className="text-sm">Store <span className="font-mono font-semibold">{storeId}</span></span>
                  <button type="button" onClick={() => { setStoreId(""); setStoreQuery(""); }}
                    className="text-xs font-semibold text-navy-600 hover:text-navy-900">Remove</button>
                </div>
              ) : (
                <>
                  <input value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)}
                    placeholder="Search a restaurant…"
                    className="w-full rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
                  {hits.length > 0 && (
                    <ul className="mt-1 max-h-36 overflow-y-auto rounded-xl border border-navy-200">
                      {hits.map((s) => (
                        <li key={s.storeId}>
                          <button type="button" onClick={() => { setStoreId(s.storeId); setHits([]); }}
                            className="flex w-full justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-navy-50">
                            <span className="truncate">{s.restaurantName}</span>
                            <span className="font-mono text-xs text-navy-500">{s.storeId}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={busy}
              className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">Cancel</button>
            <button type="submit" disabled={busy || title.trim().length < 2 || (type === "store" && !storeId)}
              className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50">
              {busy ? "Creating…" : "Start conversation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Chat = () => {
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [searchHits, setSearchHits] = useState(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const list = await chat.conversations();
      setConversations(list);
      setActiveId((cur) => cur || list[0]?.id || null);
    } catch (err) {
      setError(errorMessage(err, "Could not load conversations."));
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadThread = useCallback(async (id, { scroll = false } = {}) => {
    if (!id) return;
    try {
      const data = await chat.messages(id, { limit: 100 });
      setThread(data);
      if (scroll) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(errorMessage(err, "Could not load messages."));
    }
  }, []);

  useEffect(() => {
    if (!activeId) return undefined;
    loadThread(activeId, { scroll: true });
    const t = setInterval(() => loadThread(activeId), POLL_MS);
    return () => clearInterval(t);
  }, [activeId, loadThread]);

  // Refresh the sidebar's unread counts alongside the open thread.
  useEffect(() => {
    const t = setInterval(loadConversations, POLL_MS * 2);
    return () => clearInterval(t);
  }, [loadConversations]);

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await chat.send(activeId, body);
      await loadThread(activeId, { scroll: true });
      loadConversations();
    } catch (err) {
      setError(errorMessage(err, "Could not send the message."));
      setDraft(body); // give the text back rather than losing it
    } finally {
      setSending(false);
    }
  };

  const runSearch = async (e) => {
    e.preventDefault();
    if (search.trim().length < 2) return;
    try {
      setSearchHits(await chat.search(search.trim()));
    } catch (err) {
      setError(errorMessage(err, "Search failed."));
    }
  };

  let lastDay = null;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Chat</h1>
          <p className="mt-1 text-sm text-navy-500">
            Internal conversations. Every CSD member can read these — a colleague picking up a
            ticket needs the history.
          </p>
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-500">
          <FiPlus aria-hidden="true" /> New conversation
        </button>
      </header>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        {/* Conversation list */}
        <aside className="rounded-2xl border border-navy-200 bg-white">
          <form onSubmit={runSearch} className="border-b border-navy-100 p-3">
            <div className="flex items-center gap-2 rounded-xl border border-navy-200 px-3 py-2">
              <FiSearch className="shrink-0 text-navy-400" aria-hidden="true" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setSearchHits(null); }}
                placeholder="Search messages…" aria-label="Search messages"
                className="w-full bg-transparent text-sm outline-none" />
            </div>
          </form>

          {searchHits ? (
            <div className="max-h-[32rem] overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2 text-xs text-navy-500">
                <span>{searchHits.length} match{searchHits.length === 1 ? "" : "es"}</span>
                <button type="button" onClick={() => { setSearchHits(null); setSearch(""); }}
                  className="font-semibold text-brand-600">Clear</button>
              </div>
              {searchHits.map((h) => (
                <button key={h.id} type="button"
                  onClick={() => { setActiveId(h.conversationId); setSearchHits(null); setSearch(""); }}
                  className="block w-full border-b border-navy-100 p-3 text-left last:border-b-0 hover:bg-navy-50">
                  <div className="text-xs font-semibold text-navy-900">{h.conversationTitle}</div>
                  <div className="mt-0.5 line-clamp-2 text-xs text-navy-600">{h.body}</div>
                  <div className="mt-0.5 text-[11px] text-navy-400">{h.authorName} · {day(h.createdAt)}</div>
                </button>
              ))}
            </div>
          ) : (
            <ul className="max-h-[32rem] overflow-y-auto">
              {conversations.length === 0 && (
                <li className="p-5 text-center text-sm text-navy-500">No conversations yet.</li>
              )}
              {conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setActiveId(c.id)}
                    className={`w-full border-b border-navy-100 p-3.5 text-left last:border-b-0 ${
                      c.id === activeId ? "bg-brand-50" : "hover:bg-navy-50"
                    }`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {c.type === "store"
                          ? <FiShoppingBag size={12} className="shrink-0 text-navy-400" aria-hidden="true" />
                          : <FiHash size={12} className="shrink-0 text-navy-400" aria-hidden="true" />}
                        <span className="truncate text-sm font-semibold text-navy-900">{c.title}</span>
                      </span>
                      {c.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {c.unread}
                        </span>
                      )}
                    </div>
                    {c.storeId && <div className="mt-0.5 font-mono text-[11px] text-navy-400">{c.storeId}</div>}
                    {c.lastMessagePreview && (
                      <div className="mt-1 truncate text-xs text-navy-500">
                        <span className="font-medium">{c.lastMessageBy}:</span> {c.lastMessagePreview}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Thread */}
        <section className="flex min-h-[32rem] flex-col rounded-2xl border border-navy-200 bg-white">
          {!thread ? (
            <div className="flex flex-1 items-center justify-center p-8 text-sm text-navy-500">
              {conversations.length ? "Select a conversation." : "Start a conversation to begin."}
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-navy-200 p-4">
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-navy-900">{thread.conversation.title}</h2>
                  <p className="text-xs text-navy-500">
                    {thread.conversation.storeId ? (
                      <Link to={`/stores/${thread.conversation.storeId}`} className="text-brand-600 hover:text-brand-700">
                        {thread.conversation.restaurantName || "Store"} · {thread.conversation.storeId}
                      </Link>
                    ) : (
                      `${thread.conversation.participants.length} participant${thread.conversation.participants.length === 1 ? "" : "s"}`
                    )}
                  </p>
                </div>
              </header>

              <div className="flex-1 space-y-3 overflow-y-auto p-4" style={{ maxHeight: "26rem" }}>
                {thread.messages.length === 0 && (
                  <p className="py-8 text-center text-sm text-navy-400">No messages yet.</p>
                )}
                {thread.messages.map((m) => {
                  const d = day(m.createdAt);
                  const showDay = d !== lastDay;
                  lastDay = d;
                  return (
                    <React.Fragment key={m.id}>
                      {showDay && (
                        <div className="py-1 text-center text-[11px] font-medium text-navy-400">{d}</div>
                      )}
                      <div className={`flex ${m.isMine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                          m.isMine ? "bg-brand-600 text-white" : "bg-navy-100 text-navy-900"
                        }`}>
                          {!m.isMine && (
                            <div className="mb-0.5 text-xs font-semibold text-navy-600">
                              {m.authorName}
                              <span className="ml-1.5 font-mono font-normal text-navy-400">{m.authorStaffId}</span>
                            </div>
                          )}
                          <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                          <div className={`mt-1 text-[10px] ${m.isMine ? "text-white/70" : "text-navy-400"}`}>
                            {time(m.createdAt)}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={send} className="border-t border-navy-200 p-3">
                <div className="flex items-end gap-2">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={8000}
                    placeholder="Write a message…" aria-label="Message"
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }}
                    className="flex-1 resize-none rounded-xl border border-navy-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-500" />
                  <button type="button" disabled title="Attachments are not available yet"
                    className="cursor-not-allowed rounded-xl border border-navy-200 p-2.5 text-navy-300"
                    aria-label="Attach a file (not available yet)">
                    <FiPaperclip />
                  </button>
                  <button type="submit" disabled={sending || !draft.trim()}
                    className="rounded-xl bg-brand-600 p-2.5 text-white hover:bg-brand-500 disabled:opacity-50"
                    aria-label="Send message">
                    <FiSend />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-navy-400">
                  Enter sends · Shift+Enter for a new line · attachments coming soon
                </p>
              </form>
            </>
          )}
        </section>
      </div>

      {creating && (
        <NewConversationDialog
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); loadConversations(); setActiveId(id); }}
        />
      )}
    </div>
  );
};

export default Chat;
