import { useSyncExternalStore } from "react";

/**
 * A small value kept in localStorage that every component reads through
 * useSyncExternalStore, so the header, the list and the store page all move
 * together when the customer picks a location.
 *
 * Memory is the source of truth after the first read: where localStorage
 * throws (private mode, blocked storage) the value still works for this tab.
 * Other tabs follow through the `storage` event. `clean` vets what was read,
 * because anything in localStorage may have been edited by hand.
 */
export function localStore(key, fallback, clean = (v) => v) {
  const listeners = new Set();
  let value;
  const load = () => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? clean(JSON.parse(raw)) ?? fallback : fallback;
    } catch {
      return fallback;
    }
  };
  const get = () => (value === undefined ? (value = load()) : value);
  const set = (next) => {
    value = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode: kept for this tab only */
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    const onStorage = (e) => {
      if (e.key !== key) return;
      value = load();
      listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };
  return { get, set, subscribe };
}

const SOURCES = ["places", "gps", "area"];

/** Loc = { lat, lng, label, source, address? }; anything else is dropped. */
const cleanLoc = (l) =>
  l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && SOURCES.includes(l.source)
    ? {
        lat: l.lat,
        lng: l.lng,
        label: String(l.label || "").slice(0, 80) || "Selected location",
        ...(l.address ? { address: String(l.address).slice(0, 200) } : {}),
        source: l.source,
      }
    : null;

// The full-precision point stays on this device: the rider needs it at
// checkout. Browse requests round it (eatsFilters.toApiParams).
const locStore = localStore("ke_loc_v1", { current: null, recents: [] }, (v) => ({
  current: cleanLoc(v?.current),
  recents: (Array.isArray(v?.recents) ? v.recents : []).map(cleanLoc).filter(Boolean).slice(0, 3),
}));

const setLocation = (loc) => {
  const next = cleanLoc(loc);
  if (!next) return;
  const recents = locStore.get().recents.filter((r) => r.label !== next.label);
  locStore.set({ current: next, recents: [next, ...recents].slice(0, 3) });
};
const clearLocation = () => locStore.set({ ...locStore.get(), current: null });

/** The customer's chosen point, shared by every Knot Eats page. */
export function useEatsLocation() {
  const { current, recents } = useSyncExternalStore(locStore.subscribe, locStore.get);
  return { location: current, setLocation, clearLocation, recents };
}

const prefsStore = localStore("ke_prefs_v1", { mode: "delivery", veg: false }, (v) => ({
  mode: v?.mode === "pickup" ? "pickup" : "delivery",
  veg: v?.veg === true,
}));

const setMode = (mode) => prefsStore.set({ ...prefsStore.get(), mode: mode === "pickup" ? "pickup" : "delivery" });
const setVeg = (veg) => prefsStore.set({ ...prefsStore.get(), veg: veg === true });

/** Delivery or pickup, and the VEG switch: remembered across visits. */
export function useEatsPrefs() {
  const { mode, veg } = useSyncExternalStore(prefsStore.subscribe, prefsStore.get);
  return { mode, setMode, veg, setVeg };
}
