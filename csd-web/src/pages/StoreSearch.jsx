import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FiSearch, FiLoader, FiAlertCircle } from "react-icons/fi";
import { stores, errorMessage } from "../api";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";

// "deleted" is listed so staff can find stores that were removed before the
// purge existed: those still own their restaurant, users and orders, and are
// invisible everywhere else. Selecting it shows them so the delete can be run
// again and actually clear them.
const STATUSES = ["", "active", "pending", "suspended", "closed_temporarily", "closed_until", "deleted"];

/**
 * Store Management / Global Store Search — available to staff and admins.
 * Also the page staff are redirected to if they try to open an admin URL.
 */
const StoreSearch = () => {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);
  const location = useLocation();
  const deniedFrom = location.state?.deniedFrom;
  const { isAdmin } = useAuth();
  const [erasing, setErasing] = useState("");

  // A deleted store's record, gone for good (owner, 2026-10-31). Typing the
  // Store ID confirms it; the server checks it again and that it is deleted.
  const erase = async (r) => {
    const typed = window.prompt(
      `Delete ${r.restaurantName} (${r.storeId}) permanently?

Its record is erased and it leaves this list for good. Its signed agreement and invoices are kept for tax records.

Type the Store ID to confirm:`,
    );
    if (typed === null) return;
    if (typed.trim() !== r.storeId) {
      setError("The Store ID did not match. Nothing was deleted.");
      return;
    }
    setErasing(r.storeId);
    try {
      await stores.erase(r.storeId);
      setRows((list) => list.filter((x) => x.storeId !== r.storeId));
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Could not delete the store."));
    } finally {
      setErasing("");
    }
  };

  useEffect(() => {
    const term = q.trim();
    // Empty query is now valid — the backend returns the most recent stores
    // so an operator opening this page sees the registry, not a blank slate.
    // We only debounce and short-circuit for the awkward 1-char case.
    if (term.length === 1) {
      setBusy(false);
      return undefined;
    }
    setBusy(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const data = await stores.search({ q: term, status: status || undefined, limit: 50 });
        if (mine !== seq.current) return; // discard a stale response
        setRows(data.results);
        setTruncated(data.truncated);
        setError("");
        setSearched(true);
      } catch (err) {
        if (mine !== seq.current) return;
        setError(errorMessage(err, "Search failed."));
        setRows([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-bold text-navy-900">Store Management</h1>
      <p className="mt-1 text-sm text-navy-500">
        Search by Store ID, restaurant name, owner phone or address.
      </p>

      {deniedFrom && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <FiAlertCircle className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-mono">{deniedFrom}</span> is restricted to administrators.
          </span>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 focus-within:border-brand-500">
          {busy ? (
            <FiLoader className="shrink-0 animate-spin text-navy-400" aria-hidden="true" />
          ) : (
            <FiSearch className="shrink-0 text-navy-400" aria-hidden="true" />
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search stores…"
            aria-label="Search stores"
            className="w-full bg-transparent text-sm text-navy-900 outline-none placeholder:text-navy-400"
            autoFocus
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-xl border border-navy-200 bg-white px-3 py-2.5 text-sm text-navy-800 outline-none focus:border-brand-500"
        >
          {STATUSES.map((s) => (
            <option key={s || "all"} value={s}>
              {s ? s.replace(/_/g, " ") : "All statuses"}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {searched && !busy && rows.length === 0 && !error && (
        <p className="mt-8 text-center text-sm text-navy-500">No stores match “{q.trim()}”.</p>
      )}

      {rows.length > 0 && (
        <>
          {truncated && (
            <p className="mt-4 text-xs text-amber-700">
              Showing the first {rows.length} matches — refine your search to narrow it down.
            </p>
          )}
          {/* Phones: one card per store. The table needed sideways scrolling to reach Status and View store. */}
          <ul className="mt-4 space-y-2.5 sm:hidden">
            {rows.map((r) => (
              <li key={r.storeId} className="rounded-2xl border border-navy-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-900">{r.restaurantName}</p>
                    <p className="font-mono text-xs text-navy-500">{r.storeId}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-2 text-sm text-navy-700">
                  {r.ownerName || "—"}
                  {r.ownerPhone ? <span className="text-navy-500"> · {r.ownerPhone}</span> : null}
                </p>
                {r.address ? <p className="mt-0.5 line-clamp-2 text-xs text-navy-500">{r.address}</p> : null}
                <div className="mt-3 flex items-center justify-end gap-4 text-sm">
                  {isAdmin && r.status === "deleted" && (
                    <button
                      type="button"
                      onClick={() => erase(r)}
                      disabled={erasing === r.storeId}
                      className="font-semibold text-red-600 disabled:opacity-50"
                    >
                      {erasing === r.storeId ? "Deleting…" : "Delete permanently"}
                    </button>
                  )}
                  <Link to={`/stores/${r.storeId}`} className="font-semibold text-brand-600">
                    View store
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-navy-200 bg-white sm:block">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-navy-200 bg-navy-50 text-xs uppercase tracking-wider text-navy-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Restaurant</th>
                  <th scope="col" className="px-4 py-3">Store ID</th>
                  <th scope="col" className="px-4 py-3">Owner</th>
                  <th scope="col" className="px-4 py-3">Phone</th>
                  <th scope="col" className="px-4 py-3">Address</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.storeId} className="border-b border-navy-100 last:border-b-0 hover:bg-navy-50">
                    <td className="px-4 py-3 font-medium text-navy-900">{r.restaurantName}</td>
                    <td className="px-4 py-3 font-mono text-navy-700">{r.storeId}</td>
                    <td className="px-4 py-3 text-navy-700">{r.ownerName || "—"}</td>
                    <td className="px-4 py-3 text-navy-700">{r.ownerPhone || "—"}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-navy-500" title={r.address}>
                      {r.address || "—"}
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {isAdmin && r.status === "deleted" && (
                        <button
                          type="button"
                          onClick={() => erase(r)}
                          disabled={erasing === r.storeId}
                          className="mr-4 font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {erasing === r.storeId ? "Deleting…" : "Delete permanently"}
                        </button>
                      )}
                      <Link
                        to={`/stores/${r.storeId}`}
                        className="font-semibold text-brand-600 hover:text-brand-700"
                      >
                        View store
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default StoreSearch;
