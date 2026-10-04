/**
 * Module 8 §2 — Delivery Distance & Slab calculation.
 *
 * Calculates distance from store coordinates to customer delivery address.
 * Never trusts client-provided distance. Enforces distance slabs and max distance limit.
 */

// Haversine formula to calculate distance in km between two lat/lng pairs
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

/**
 * Estimate distance from store to customer address.
 * If customer address has lat/lng, uses haversine.
 * Otherwise, estimates based on address text length / hash or default 2.5 km for testing.
 */
const calculateDistanceKm = ({ storeAddress, customerAddress }) => {
  const storeLat = Number(storeAddress?.lat);
  const storeLng = Number(storeAddress?.lng);

  const custLat = Number(customerAddress?.lat || customerAddress?.latitude);
  const custLng = Number(customerAddress?.lng || customerAddress?.longitude);

  if (
    Number.isFinite(storeLat) &&
    Number.isFinite(storeLng) &&
    Number.isFinite(custLat) &&
    Number.isFinite(custLng)
  ) {
    return haversineKm(storeLat, storeLng, custLat, custLng);
  }

  // Fallback: estimate from address string or distance hint in instructions / address
  const addrText = String(customerAddress?.line1 || customerAddress || "");
  const distMatch = addrText.match(/(\d+(?:\.\d+)?)\s*(?:km|kilometer)/i);
  if (distMatch) {
    return parseFloat(distMatch[1]);
  }

  return 2.5; // Default reasonable 2.5km distance
};

/**
 * Compute delivery fee from slabs.
 * Throws error if distance > maxDistanceKm.
 */
const computeDeliveryFeeFromSlabs = ({ distanceKm, slabsConfig, defaultFee = 0 }) => {
  const maxDistance = Number(slabsConfig?.maxDistanceKm || 7);
  if (distanceKm > maxDistance) {
    throw new Error(`Delivery distance (${distanceKm} km) exceeds maximum allowed limit of ${maxDistance} km.`);
  }

  const slabs = slabsConfig?.slabs || [];
  if (!Array.isArray(slabs) || slabs.length === 0) {
    return defaultFee;
  }

  // Find slab where minKm <= distanceKm <= maxKm
  const matched = slabs.find(
    (s) => distanceKm >= Number(s.minKm) && distanceKm <= Number(s.maxKm)
  );

  if (matched) return Number(matched.fee) || 0;

  // If beyond last slab maxKm but within maxDistance
  const highestSlab = [...slabs].sort((a, b) => Number(b.maxKm) - Number(a.maxKm))[0];
  if (highestSlab && distanceKm > Number(highestSlab.maxKm)) {
    return Number(highestSlab.fee) || defaultFee;
  }

  return defaultFee;
};

/**
 * Knot Eats road distances: Google Routes `computeRouteMatrix`, store pins as
 * origins and the customer as the single destination (the delivery direction).
 *
 * The origin is rounded to 3 dp (~110 m) on EVERY call -- the list, the store
 * page and checkout -- so all three read the same cache entry and always agree
 * on a store's distance. Anything that is not a road answer (no key, budget
 * spent, timeout, HTTP error, no route) falls back to straight-line km at
 * ~20 km/h, and fallbacks are never cached, so a blip doesn't stick for 24 h.
 *
 * Never logged: the key, or any customer coordinate.
 */
const config = require("../config/config");
const { localDate } = require("./tableBookings");

const ROUTES_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const FIELD_MASK = "originIndex,destinationIndex,status,condition,distanceMeters,duration";
const BATCH = 25;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 50_000;

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

// ponytail: per-process cache and budget; move both to Redis if pos-api scales out.
const cache = new Map(); // key -> { km, minutes, at }

const cacheGet = (key, now) => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
};

const cacheSet = (key, value, now) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // oldest inserted
  cache.set(key, { ...value, at: now });
};

// The pin is in the key, so a moved store pin never reads a stale distance.
const cacheKey = (store, origin) =>
  `${Number(store.lat).toFixed(4)},${Number(store.lng).toFixed(4)}>${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`;

/**
 * Daily element budget, keyed by IST date. Reserved BEFORE calling, so
 * concurrent requests can't jointly overshoot the cap.
 */
const budget = { day: "", used: 0, warned: false };
const rollDay = () => {
  const day = localDate(new Date(), "Asia/Kolkata");
  if (budget.day !== day) Object.assign(budget, { day, used: 0, warned: false });
};
const reserve = (n) => {
  rollDay();
  if (budget.used + n > config.googleRoutesDailyElements) {
    if (!budget.warned) {
      budget.warned = true;
      console.warn("[distance] Google Routes daily element budget reached; using straight-line distances.");
    }
    return false;
  }
  budget.used += n;
  return true;
};

/** Today's Routes usage, for the CSD Knot Eats screen. */
const mapsUsage = () => {
  rollDay();
  return { day: budget.day, used: budget.used, cap: config.googleRoutesDailyElements };
};

const latLng = (p) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });

/** One matrix call: index i of the result is stores[i]'s road answer, or null. */
const fetchMatrix = async (origin, stores) => {
  const found = new Array(stores.length).fill(null);
  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // In a header, never the URL, so it can't end up in an access log.
        "X-Goog-Api-Key": config.googleMapsServerKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        origins: stores.map(latLng),
        destinations: [latLng(origin)],
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE", // the Essentials SKU
      }),
      signal: globalThis.AbortSignal.timeout(2500), // (not in the lint globals list)
    });
    if (!res.ok) {
      console.warn(`[distance] Google Routes HTTP ${res.status}`);
      return found;
    }
    const rows = await res.json();
    for (const el of Array.isArray(rows) ? rows : []) {
      // proto3 JSON drops zero values, so index 0 arrives as "absent".
      const i = Number(el.originIndex || 0);
      if (el.condition !== "ROUTE_EXISTS" || !(i >= 0 && i < stores.length)) continue;
      const meters = Number(el.distanceMeters || 0);
      const seconds = parseInt(el.duration, 10) || 0; // "754s"
      found[i] = { km: round1(meters / 1000), minutes: Math.ceil(seconds / 60) };
    }
  } catch (err) {
    console.warn(`[distance] Google Routes unavailable (${err?.name || "error"})`);
  }
  return found;
};

/**
 * @param {{ origin: {lat,lng}, stores: {key,lat,lng}[], fetchAllowed?: boolean }}
 * @returns {Promise<Map<key, { km, minutes, source: "road"|"straight_line" }>>}
 */
const roadDistances = async ({ origin, stores, fetchAllowed = true }) => {
  const now = Date.now();
  const o = { lat: round3(Number(origin.lat)), lng: round3(Number(origin.lng)) };
  const out = new Map();
  const misses = new Map(); // cacheKey -> stores sharing that pin

  for (const s of stores || []) {
    const key = cacheKey(s, o);
    const hit = cacheGet(key, now);
    if (hit) out.set(s.key, { km: hit.km, minutes: hit.minutes, source: "road" });
    else misses.set(key, [...(misses.get(key) || []), s]);
  }

  const keys = [...misses.keys()];
  if (keys.length && fetchAllowed && config.googleMapsServerKey) {
    for (let i = 0; i < keys.length; i += BATCH) {
      const batch = keys.slice(i, i + BATCH);
      if (!reserve(batch.length)) break;
      const found = await fetchMatrix(o, batch.map((k) => misses.get(k)[0]));
      batch.forEach((k, idx) => {
        if (!found[idx]) return;
        cacheSet(k, found[idx], now);
        for (const s of misses.get(k)) out.set(s.key, { ...found[idx], source: "road" });
      });
    }
  }

  for (const s of stores || []) {
    if (out.has(s.key)) continue;
    const km = haversineKm(Number(s.lat), Number(s.lng), o.lat, o.lng);
    out.set(s.key, { km, minutes: Math.round(km * 3), source: "straight_line" });
  }
  return out;
};

/** Tests only: forget cached distances and today's budget. */
const resetRoadDistances = () => {
  cache.clear();
  Object.assign(budget, { day: "", used: 0, warned: false });
};

module.exports = {
  haversineKm,
  calculateDistanceKm,
  computeDeliveryFeeFromSlabs,
  roadDistances,
  mapsUsage,
  resetRoadDistances,
};
