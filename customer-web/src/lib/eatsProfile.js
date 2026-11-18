import { useSyncExternalStore } from "react";
import { localStore } from "./eatsLocation.js";

/**
 * The diner's details on THIS device (Knot Eats has no accounts): the name
 * and mobile checkout fills in, and saved delivery addresses (Home, Work,
 * Other). Kept only when the diner ticks "Remember on this device" at
 * checkout, and wiped from Account > Clear my data. Never sent anywhere
 * except as part of an order they place.
 */

const MAX_ADDRESSES = 6;
const LABELS = ["Home", "Work", "Other"];
const str = (v, max) => String(v ?? "").trim().slice(0, max);
let seq = 0;
// Unique even for two addresses saved in the same millisecond.
const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** An address as checkout uses it; anything malformed is dropped. */
export const cleanAddress = (a) => {
  if (!a || typeof a !== "object") return null;
  const line1 = str(a.line1, 160);
  if (!line1) return null;
  const lat = Number(a.lat);
  const lng = Number(a.lng);
  const pin = str(a.postalCode, 6);
  return {
    id: str(a.id, 40) || newId(),
    label: LABELS.includes(a.label) ? a.label : "Other",
    line1,
    line2: str(a.line2, 160),
    city: str(a.city, 60),
    postalCode: /^[1-9]\d{5}$/.test(pin) ? pin : "",
    instructions: str(a.instructions, 200),
    ...(Number.isFinite(lat) && Number.isFinite(lng) && a.lat !== "" && a.lng !== "" ? { lat, lng } : {}),
  };
};

const cleanProfile = (v) => ({
  name: str(v?.name, 60),
  phone: /^[6-9]\d{9}$/.test(String(v?.phone || "")) ? String(v.phone) : "",
  addresses: (Array.isArray(v?.addresses) ? v.addresses : []).map(cleanAddress).filter(Boolean).slice(0, MAX_ADDRESSES),
});

const EMPTY = { name: "", phone: "", addresses: [] };
const store = localStore("ke_profile_v1", EMPTY, cleanProfile);

/** Name and phone, as typed at checkout (only a valid mobile is kept). */
export const saveContact = ({ name, phone }) => store.set(cleanProfile({ ...store.get(), name, phone }));

const samePlace = (x, a) => ["line1", "line2", "city", "postalCode"].every((k) => x[k].toLowerCase() === a[k].toLowerCase());

/**
 * One address per label for Home and Work (a new Home replaces the old one);
 * "Other" adds. The same place saved again (checkout saves it with each
 * order) replaces its old copy rather than adding one. The newest is first,
 * so checkout offers it first.
 */
export const saveAddress = (address) => {
  const a = cleanAddress(address);
  if (!a) return null;
  const rest = store.get().addresses.filter((x) => x.id !== a.id && !samePlace(x, a) && (a.label === "Other" || x.label !== a.label));
  store.set(cleanProfile({ ...store.get(), addresses: [a, ...rest] }));
  return a;
};

export const removeAddress = (id) => store.set({ ...store.get(), addresses: store.get().addresses.filter((a) => a.id !== id) });

/** Account > Clear my data: details and addresses (orders and favourites are cleared by their own stores). */
export const clearProfile = () => store.set(EMPTY);

/** The current profile, outside React (checkout reads it once when it opens). */
export const getProfile = () => store.get();

export function useEatsProfile() {
  return useSyncExternalStore(store.subscribe, store.get);
}

export const ADDRESS_LABELS = LABELS;
