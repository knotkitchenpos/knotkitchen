import React, { useEffect, useRef, useState } from "react";
import useScrollLock from "../../lib/useScrollLock";
import { useEatsLocation } from "../../lib/eatsLocation";
import { loadGoogle, newSessionToken, placeToLoc, reverseGeocode, suggestPlaces } from "../../lib/googleMaps";
import { FOCUS, useEatsConfig } from "../shared";
import { PinIcon } from "./EatsHeader";

/**
 * Where to look for restaurants, in the order that never leaves the site
 * without a way forward (§10.7):
 *   1. Places search, only when the config has a browser key and Google loads;
 *   2. "Use my current location" (GPS), named by reverse geocoding when it can;
 *   3. the areas Knot Eats has stores in: browse and pickup only, never a
 *      delivery point.
 * A native <dialog>; picking anything closes it.
 */
export default function LocationPicker({ open, onClose }) {
  return open ? <Picker onClose={onClose} /> : null;
}

const GEO_OPTIONS = { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 };

function Picker({ onClose }) {
  const ref = useRef(null);
  const inputRef = useRef(null);
  const session = useRef(undefined);
  const config = useEatsConfig();
  const key = config?.maps?.browserKey || "";
  const areas = config?.areas || [];
  const { location, setLocation, recents } = useEatsLocation();
  const [google, setGoogle] = useState(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const hasGps = typeof navigator !== "undefined" && "geolocation" in navigator;
  useScrollLock();

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // The Maps script is fetched only now, when someone opens the picker.
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    loadGoogle(key).then((g) => live && g && setGoogle(g));
    return () => {
      live = false;
    };
  }, [key]);
  useEffect(() => {
    if (google) inputRef.current?.focus();
  }, [google]);

  // Suggestions 300 ms after the last key, from 3 characters.
  useEffect(() => {
    const text = q.trim();
    if (!google || text.length < 3) {
      setItems([]);
      return undefined;
    }
    let live = true;
    const t = window.setTimeout(async () => {
      if (!session.current) session.current = newSessionToken();
      const found = await suggestPlaces(text, { sessionToken: session.current, bias: location });
      if (!live) return;
      setItems(found);
      setActive(-1);
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q, google, location]);

  const pick = (loc) => {
    setLocation(loc);
    onClose();
  };

  const choose = async (item) => {
    setBusy("place");
    setError("");
    const loc = await placeToLoc(item.prediction);
    session.current = undefined; // the details call closed this session
    setBusy("");
    if (loc) pick(loc);
    else setError("We couldn't find that place. Try another search.");
  };

  const locate = () => {
    setBusy("gps");
    setError("");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const point = { lat: coords.latitude, lng: coords.longitude };
        const g = key ? await loadGoogle(key) : null;
        const label = g ? await reverseGeocode(point) : "";
        setBusy("");
        pick({ ...point, label: label || "Current location", source: "gps" });
      },
      (err) => {
        setBusy("");
        setError(
          err.code === 1
            ? "Location permission is off. Search your area instead."
            : "We couldn't get your location. Search your area instead.",
        );
      },
      GEO_OPTIONS,
    );
  };

  const onKeyDown = (e) => {
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === "Escape") {
      // First Esc closes the suggestions; the next one closes the dialog.
      e.preventDefault();
      e.stopPropagation();
      setItems([]);
    }
  };

  const text = q.trim();
  const row = `flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${FOCUS}`;

  return (
    <dialog
      ref={ref}
      aria-labelledby="ke-loc-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-0 mt-auto w-full max-w-none rounded-t-2xl bg-white p-0 text-[color:var(--ke-ink)] backdrop:bg-black/50 sm:m-auto sm:max-w-lg sm:rounded-2xl"
    >
      <div className="max-h-[85vh] overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-2">
        <div className="flex items-center justify-between">
          <h2 id="ke-loc-title" className="text-[18px] font-bold">
            Select a location
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-500 ${FOCUS}`}>
            ×
          </button>
        </div>

        {google ? (
          <div className="mt-2">
            <label htmlFor="ke-loc-q" className="sr-only">
              Search for your area, street or landmark
            </label>
            <input
              id="ke-loc-q"
              ref={inputRef}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={items.length > 0}
              aria-controls="ke-loc-list"
              aria-activedescendant={active >= 0 ? `ke-loc-opt-${active}` : undefined}
              autoComplete="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search for area, street name…"
              className="min-h-[48px] w-full rounded-xl border border-slate-300 px-3 text-[16px] outline-none focus:border-brand focus:ring-1 focus:ring-brand"
            />
            <p className="sr-only" aria-live="polite">
              {text.length >= 3 ? `${items.length} suggestion${items.length === 1 ? "" : "s"}` : ""}
            </p>
            <ul id="ke-loc-list" role="listbox" aria-label="Suggestions" className={items.length ? "mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200" : "hidden"}>
              {items.map((it, i) => (
                <li
                  key={it.id}
                  id={`ke-loc-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => choose(it)}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-[44px] cursor-pointer items-start gap-2 px-3 py-2.5 ${i === active ? "bg-orange-50" : ""}`}
                >
                  <span className="mt-0.5 shrink-0 text-slate-400">
                    <PinIcon />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{it.main}</span>
                    {it.secondary ? <span className="block truncate text-[13px] text-slate-500">{it.secondary}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {/* Places policy, predictions with no Google map: the Google Maps logo,
                or the exact text "Google Maps" in Roboto/sans-serif 400, 12-16px,
                #5E5E5E, untranslated. "Powered by Google" is no longer accepted. */}
            <p translate="no" className="mt-1.5 text-right" style={{ font: "400 12px Roboto, sans-serif", color: "#5E5E5E" }}>
              Google Maps
            </p>
          </div>
        ) : null}

        {hasGps ? (
          <button type="button" onClick={locate} disabled={busy === "gps"} className={`mt-3 border border-slate-200 font-semibold text-brand ${row}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {busy === "gps" ? "Finding you…" : "Use my current location"}
          </button>
        ) : null}
        {busy === "place" ? <p className="mt-2 text-[14px] text-slate-600">Finding that place…</p> : null}
        {error ? (
          <p role="alert" className="mt-2 text-[14px] text-[color:var(--ke-bad)]">
            {error}
          </p>
        ) : null}

        {recents.length ? (
          <section aria-labelledby="ke-loc-recent" className="mt-5">
            <h3 id="ke-loc-recent" className="text-[13px] font-bold uppercase tracking-wider text-slate-500">
              Recent locations
            </h3>
            <ul className="mt-1">
              {recents.map((r) => (
                <li key={`${r.label}-${r.lat}`}>
                  <button type="button" onClick={() => pick(r)} className={`${row} hover:bg-slate-50`}>
                    <span className="shrink-0 text-slate-400">
                      <PinIcon />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{r.label}</span>
                      {r.address ? <span className="block truncate text-[13px] text-slate-500">{r.address}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {areas.length ? (
          <section aria-labelledby="ke-loc-areas" className="mt-5">
            <h3 id="ke-loc-areas" className="text-[13px] font-bold uppercase tracking-wider text-slate-500">
              Areas on Knot Eats
            </h3>
            <p className="mt-0.5 text-[13px] text-slate-500">To browse and pick up. For delivery, use your exact location.</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {areas.map((a) => (
                <li key={a.label}>
                  <button
                    type="button"
                    onClick={() => pick({ lat: a.lat, lng: a.lng, label: a.label, source: "area" })}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-slate-300 px-4 text-[14px] font-medium text-slate-700 hover:border-brand ${FOCUS}`}
                  >
                    {a.label}
                    {a.storeCount ? <span className="text-slate-400">· {a.storeCount}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {config && !google && !areas.length && !hasGps ? (
          <p className="mt-4 text-[15px] text-slate-600">Location search isn&apos;t available right now. Please try again later.</p>
        ) : null}
      </div>
    </dialog>
  );
}
