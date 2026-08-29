import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiSearch, FiLoader } from "react-icons/fi";
import { stores, errorMessage } from "../api";
import StatusBadge from "./StatusBadge";

/**
 * Header global search: Store ID, restaurant name, owner phone or address.
 *
 * Debounced at 300ms and guarded by a request sequence number — responses can
 * arrive out of order, and without the sequence check a slow reply for an
 * earlier query can overwrite the results of a later one.
 */
const GlobalSearch = () => {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const boxRef = useRef(null);
  const seq = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setBusy(false);
      setError("");
      return undefined;
    }

    setBusy(true);
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const data = await stores.search({ q: term, limit: 8 });
        if (mine !== seq.current) return; // a newer query already won
        setResults(data.results);
        setError("");
      } catch (err) {
        if (mine !== seq.current) return;
        setError(errorMessage(err, "Search failed."));
        setResults([]);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [q]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const openStore = (storeId) => {
    setOpen(false);
    setQ("");
    navigate(`/stores/${storeId}`);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-2xl">
      <div className="flex items-center gap-2.5 rounded-xl border border-navy-200 bg-white px-3.5 py-2.5 focus-within:border-brand-500">
        {busy ? (
          <FiLoader className="shrink-0 animate-spin text-navy-400" aria-hidden="true" />
        ) : (
          <FiSearch className="shrink-0 text-navy-400" aria-hidden="true" />
        )}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search KnotKitchen Business"
          aria-label="Search stores by ID, name, owner phone or address"
          className="w-full bg-transparent text-sm text-navy-900 outline-none placeholder:text-navy-400"
        />
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[26rem] overflow-y-auto rounded-xl border border-navy-200 bg-white shadow-xl">
          {error && <p className="p-4 text-sm text-red-600">{error}</p>}

          {!error && !busy && results.length === 0 && (
            <p className="p-4 text-sm text-navy-500">
              No stores match “{q.trim()}”.
            </p>
          )}

          {/* §17 — one compact card per restaurant. The whole card is the
              click target, with an explicit "View Store" affordance. */}
          {results.map((r) => (
            <button
              key={r.storeId}
              type="button"
              onClick={() => openStore(r.storeId)}
              className="flex w-full items-start gap-3 border-b border-navy-100 p-3.5 text-left last:border-b-0 hover:bg-navy-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-navy-900">{r.restaurantName}</span>
                  <StatusBadge status={r.status} />
                </div>
                <div className="mt-0.5 text-xs text-navy-500">
                  Store ID: <span className="font-mono">{r.storeId}</span>
                </div>
                {r.website && (
                  <div className="mt-0.5 truncate text-xs text-navy-500">
                    <span aria-hidden="true">🌐</span> {r.website.replace(/^https?:\/\//, "")}
                  </div>
                )}
                {r.address && (
                  <div className="mt-0.5 truncate text-xs text-navy-400">
                    <span aria-hidden="true">📍</span> {r.address}
                  </div>
                )}
              </div>
              <span className="shrink-0 self-center text-xs font-semibold text-brand-600">View store</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default GlobalSearch;
