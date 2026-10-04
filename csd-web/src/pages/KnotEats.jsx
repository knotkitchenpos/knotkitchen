import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import { knotEats as api, errorMessage, fieldErrors } from "../api";
import { dt, num } from "../lib/format";

/**
 * Knot Eats (eats.knotkitchen.com), the marketplace over stores' websites.
 *
 * Owners opt in from the POS, and nothing here can opt a store in: that is
 * their consent to the fee. CSD can only take things down. An admin delists or
 * relists a store, and any staff member hides or unhides a review. Each needs
 * a reason, which the server audits.
 */

const TABS = [
  { key: "stores", label: "Stores" },
  { key: "reviews", label: "Reviews" },
];
const STORE_STATES = [
  { key: "listed", label: "Live" },
  { key: "blocked", label: "Opted in but not live" },
  { key: "delisted", label: "Delisted" },
  { key: "all", label: "All" },
];
const REVIEW_STATES = [
  { key: "visible", label: "Visible" },
  { key: "hidden", label: "Hidden" },
  { key: "all", label: "All" },
];

const PILLS = {
  live: ["Live", "bg-emerald-50 text-emerald-700 ring-emerald-600/20"],
  blocked: ["Not live", "bg-amber-50 text-amber-700 ring-amber-600/20"],
  delisted: ["Delisted", "bg-red-50 text-red-700 ring-red-600/20"],
  off: ["Not opted in", "bg-navy-100 text-navy-600 ring-navy-500/20"],
};
const statusOf = (r) => (r.delisted ? "delisted" : r.listed ? "live" : r.enabled ? "blocked" : "off");
// The pill already says these two; the rest are what stands between the store and going live.
const blockersOf = (r) => (r.blockers || []).filter((b) => b.code !== "DELISTED" && b.code !== "NOT_OPTED_IN");

const chip = (on) =>
  `rounded-xl px-3 py-2 text-sm font-semibold ${
    on ? "bg-navy-900 text-white" : "border border-navy-200 bg-white text-navy-700 hover:bg-navy-50"
  }`;
const field = "rounded-xl border border-navy-200 px-3 py-2 text-sm outline-none focus:border-brand-500";

/** One paged list that reloads (debounced) when its filters change; only the latest answer is shown. */
const usePaged = (fetchPage) => {
  const [data, setData] = useState(null); // { rows, meta }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);

  const load = useCallback(
    async (page = 1) => {
      const mine = ++seq.current;
      setBusy(true);
      setError("");
      try {
        const res = await fetchPage(page);
        if (mine === seq.current) setData(res);
      } catch (err) {
        if (mine === seq.current) setError(errorMessage(err, "Could not load this list."));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [fetchPage]
  );

  useEffect(() => {
    const t = setTimeout(() => load(1), 250);
    return () => clearTimeout(t);
  }, [load]);

  return { rows: data?.rows || [], meta: data?.meta || {}, loaded: Boolean(data), error, busy, load };
};

const Pager = ({ meta, busy, load }) => {
  const page = meta.page || 1;
  if (page <= 1 && !meta.hasMore) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <button type="button" disabled={page <= 1 || busy} onClick={() => load(page - 1)}
        className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Previous page">
        <FiChevronLeft />
      </button>
      <span className="text-sm text-navy-600">Page {page}</span>
      <button type="button" disabled={!meta.hasMore || busy} onClick={() => load(page + 1)}
        className="rounded-lg border border-navy-300 p-1.5 disabled:opacity-40" aria-label="Next page">
        <FiChevronRight />
      </button>
    </div>
  );
};

const Empty = ({ children }) => (
  <p className="mt-4 rounded-2xl border border-navy-200 bg-white p-8 text-center text-sm text-navy-500">{children}</p>
);

/**
 * Asks for the audited reason in a native <dialog>, which brings the focus
 * trap, Esc and the backdrop. On failure it stays open with the server's message.
 */
const ReasonDialog = ({ title, detail, action, danger, onConfirm, onClose }) => {
  const ref = useRef(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    const r = reason.trim();
    if (r.length < 5 || r.length > 300) return setErr("Give a reason of 5 to 300 characters.");
    setBusy(true);
    setErr("");
    try {
      await onConfirm(r); // the parent unmounts this on success
    } catch (e2) {
      setErr(fieldErrors(e2).reason || errorMessage(e2));
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { if (busy) e.preventDefault(); }}
      aria-labelledby="ke-reason-title"
      className="w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-6 shadow-2xl backdrop:bg-black/50">
      <form onSubmit={submit}>
        <h2 id="ke-reason-title" className="text-lg font-bold text-navy-900">{title}</h2>
        <p className="mt-1 text-sm text-navy-600">{detail}</p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-navy-600">Reason</span>
          <textarea value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }}
            rows={3} maxLength={300} aria-invalid={Boolean(err)}
            className={`w-full ${field} ${err ? "border-red-400" : ""}`} />
        </label>
        {err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}
        <p className="mt-2 text-xs text-navy-400">Recorded against your name.</p>
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-xl border border-navy-300 px-4 py-2.5 text-sm font-semibold text-navy-700 hover:bg-navy-50">
            Cancel
          </button>
          <button type="submit" disabled={busy}
            className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
              danger ? "bg-red-600 hover:bg-red-500" : "bg-brand-600 hover:bg-brand-500"
            }`}>
            {busy ? "Saving…" : action}
          </button>
        </div>
      </form>
    </dialog>
  );
};

const StoresTab = ({ initialQ, onReviews }) => {
  const [state, setState] = useState("all");
  const [q, setQ] = useState(initialQ);
  const [target, setTarget] = useState(null); // the row being delisted or relisted

  const fetchPage = useCallback(
    (page) => api.stores({ state, page, ...(q.trim() ? { q: q.trim() } : {}) }),
    [state, q]
  );
  const { rows, meta, loaded, error, busy, load } = usePaged(fetchPage);
  const usage = meta.mapsUsage;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-navy-200 bg-white p-4">
        {STORE_STATES.map((s) => (
          <button key={s.key} type="button" aria-pressed={state === s.key} onClick={() => setState(s.key)}
            className={chip(state === s.key)}>
            {s.label}
          </button>
        ))}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search store name or ID…"
          aria-label="Search stores" className={`min-w-[12rem] flex-1 ${field}`} />
      </div>

      {usage && (
        <p className="mt-3 text-xs text-navy-500">
          Google road distances today: {num(usage.used)} / {num(usage.cap)}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {busy && !loaded && <p className="mt-6 text-sm text-navy-500">Loading stores…</p>}

      {loaded && rows.length === 0 && (
        <Empty>{state === "all" && !q.trim() ? "No stores have opted in yet." : "No stores match these filters."}</Empty>
      )}

      {rows.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-navy-200 bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
              <tr>
                <th scope="col" className="px-4 py-3">Store</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Rating</th>
                <th scope="col" className="px-4 py-3 text-right">Orders, 30 days</th>
                {meta.canEdit && <th scope="col" className="px-4 py-3"><span className="sr-only">Action</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const [label, style] = PILLS[statusOf(r)];
                const blockers = blockersOf(r);
                return (
                  <tr key={r.storeId} className="border-b border-navy-100 align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <Link to={`/stores/${r.storeId}`} className="font-medium text-navy-900 hover:text-brand-700">
                        {r.name || "—"}
                      </Link>
                      <div className="text-xs text-navy-400">
                        <span className="font-mono">{r.storeId}</span>
                        {r.city ? ` · ${r.city}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style}`}>
                        {label}
                      </span>
                      {r.delisted ? (
                        <p className="mt-1 max-w-xs text-xs text-navy-600">
                          {r.delistedReason}
                          <span className="block text-navy-400">
                            {[r.delistedBy, r.delistedAt && dt(r.delistedAt)].filter(Boolean).join(" · ")}
                          </span>
                        </p>
                      ) : !r.listed && blockers.length > 0 ? (
                        <ul className="mt-1 max-w-xs list-disc pl-4 text-xs text-navy-600">
                          {blockers.map((b) => <li key={b.code}>{b.message}</li>)}
                        </ul>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <button type="button" onClick={() => onReviews(r.storeId)} title="See this store's reviews"
                        className="font-medium text-brand-600 hover:text-brand-700">
                        {r.rating == null ? "New" : `${Number(r.rating).toFixed(1)} ★`}
                        <span className="ml-1 text-xs text-navy-400">({num(r.ratingCount)})</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-navy-900">{num(r.orders30d)}</td>
                    {meta.canEdit && (
                      <td className="px-4 py-3 text-right">
                        <button type="button" onClick={() => setTarget(r)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                            r.delisted
                              ? "border-navy-300 text-navy-700 hover:bg-navy-50"
                              : "border-red-200 text-red-600 hover:bg-red-50"
                          }`}>
                          {r.delisted ? "Relist" : "Delist"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager meta={meta} busy={busy} load={load} />

      {target && (
        <ReasonDialog
          title={`${target.delisted ? "Relist" : "Delist"} ${target.name || target.storeId}?`}
          detail={
            target.delisted
              ? "The store goes back on Knot Eats as soon as nothing else blocks it. The owner's opt-in is unchanged."
              : "The store leaves Knot Eats at once: its card, its page and its checkout. Orders already placed carry on. The owner sees your reason in the POS and cannot undo this."
          }
          action={target.delisted ? "Relist" : "Delist"}
          danger={!target.delisted}
          onConfirm={async (reason) => {
            await api.setListing(target.storeId, { delisted: !target.delisted, reason });
            setTarget(null);
            load(meta.page || 1);
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
};

const Stars = ({ rating }) => {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating)) || 0));
  return (
    <span role="img" aria-label={`Rated ${n} out of 5`} className="text-base tracking-wide text-amber-500">
      {"★".repeat(n)}
      <span className="text-navy-200">{"★".repeat(5 - n)}</span>
    </span>
  );
};

const ReviewsTab = ({ storeId, setStoreId }) => {
  const [state, setState] = useState("visible");
  const [low, setLow] = useState(false);
  const [target, setTarget] = useState(null); // the review being hidden or unhidden
  // A part-typed store ID is not a filter yet.
  const sid = /^\d{6}$/.test(storeId) ? storeId : "";

  const fetchPage = useCallback(
    (page) => api.reviews({ state, page, ...(low ? { maxRating: 2 } : {}), ...(sid ? { storeId: sid } : {}) }),
    [state, low, sid]
  );
  const { rows, meta, loaded, error, busy, load } = usePaged(fetchPage);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-navy-200 bg-white p-4">
        {REVIEW_STATES.map((s) => (
          <button key={s.key} type="button" aria-pressed={state === s.key} onClick={() => setState(s.key)}
            className={chip(state === s.key)}>
            {s.label}
          </button>
        ))}
        <button type="button" aria-pressed={low} onClick={() => setLow((v) => !v)} className={chip(low)}>
          ≤ 2★
        </button>
        <input value={storeId} onChange={(e) => setStoreId(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric" placeholder="Store ID" aria-label="Filter by store ID" className={`w-32 ${field}`} />
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {busy && !loaded && <p className="mt-6 text-sm text-navy-500">Loading reviews…</p>}
      {loaded && rows.length === 0 && (
        <Empty>{state === "visible" && !low && !sid ? "No reviews yet." : "No reviews match these filters."}</Empty>
      )}

      {rows.length > 0 && (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.id}
              className={`rounded-2xl border bg-white p-4 ${r.hidden ? "border-dashed border-navy-300" : "border-navy-200"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Stars rating={r.rating} />
                  <p className="mt-0.5 text-xs text-navy-500">
                    {r.authorName || "Knot Eats customer"} ·{" "}
                    <Link to={`/stores/${r.storeId}`} className="text-brand-600 hover:text-brand-700">
                      {r.storeName || r.storeId}
                    </Link>{" "}
                    · Order <span className="font-mono">{r.orderNumber || "—"}</span> · {dt(r.createdAt)}
                  </p>
                </div>
                <button type="button" onClick={() => setTarget(r)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    r.hidden ? "border-navy-300 text-navy-700 hover:bg-navy-50" : "border-red-200 text-red-600 hover:bg-red-50"
                  }`}>
                  {r.hidden ? "Unhide" : "Hide"}
                </button>
              </div>
              {/* A text child, never HTML: the review is whatever the customer typed. */}
              {r.text ? (
                <p className="mt-2 whitespace-pre-line break-words text-sm text-navy-900">{r.text}</p>
              ) : (
                <p className="mt-2 text-sm italic text-navy-400">Rating only, no text.</p>
              )}
              {r.hidden && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Hidden{r.hiddenBy ? ` by ${r.hiddenBy}` : ""}{r.hiddenAt ? ` on ${dt(r.hiddenAt)}` : ""}
                  {r.hiddenReason ? `: ${r.hiddenReason}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pager meta={meta} busy={busy} load={load} />

      {target && (
        <ReasonDialog
          title={target.hidden ? "Unhide this review?" : "Hide this review?"}
          detail={
            target.hidden
              ? "It shows on the store's Knot Eats page again and counts towards its rating."
              : "It comes off the store's Knot Eats page and stops counting towards its rating."
          }
          action={target.hidden ? "Unhide" : "Hide"}
          danger={!target.hidden}
          onConfirm={async (reason) => {
            await api.setReviewHidden(target.id, { hidden: !target.hidden, reason });
            setTarget(null);
            load(meta.page || 1);
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
};

const KnotEats = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "reviews" ? "reviews" : "stores";
  const go = (next) => setParams(next, { replace: true });

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5">
        <h1 className="text-2xl font-bold text-navy-900">Knot Eats</h1>
        <p className="mt-1 text-sm text-navy-500">
          The marketplace at eats.knotkitchen.com. Owners list their store from the POS; from here you can delist a
          store or hide a review.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Knot Eats">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
            onClick={() => go({ tab: t.key })} className={chip(tab === t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stores" ? (
        <StoresTab initialQ={params.get("q") || ""} onReviews={(storeId) => go({ tab: "reviews", storeId })} />
      ) : (
        <ReviewsTab
          storeId={params.get("storeId") || ""}
          setStoreId={(storeId) => go(storeId ? { tab: "reviews", storeId } : { tab: "reviews" })}
        />
      )}
    </div>
  );
};

export default KnotEats;
