import { useSyncExternalStore } from "react";
import { localStore } from "./eatsLocation";

// Saved restaurants live on this device only: Knot Eats has no accounts.
const CAP = 100;

const saved = localStore("ke_saved_v1", [], (v) =>
  Array.isArray(v) ? v.map(String).filter((id) => /^\d{6}$/.test(id)).slice(0, CAP) : [],
);

/** Newest first; at the cap the oldest save drops off. */
const toggle = (storeId) => {
  const id = String(storeId);
  const ids = saved.get();
  saved.set(ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, CAP));
};

export function useSaved() {
  const ids = useSyncExternalStore(saved.subscribe, saved.get);
  return { ids, isSaved: (id) => ids.includes(String(id)), toggle };
}
