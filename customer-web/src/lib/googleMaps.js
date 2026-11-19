/**
 * Google in the browser, for the Knot Eats location picker only: Places
 * Autocomplete (New) and reverse geocoding, with no map (contract §4.2).
 *
 * The only file that names the Maps host (eatsSecurity.test.mjs). The key is
 * the referrer-restricted browser key from GET /api/eats/config, read at run
 * time: never in the bundle, never in a VITE_* variable.
 *
 * Nothing here throws. A blocked script, a bad key or a spent quota gives
 * null / [] / "", and the picker falls back to GPS and the area chips.
 */

// Copied from pos-frontend/src/utils/cashfree.js: resolves null, never rejects.
const loadScript = (src, pick) =>
  new Promise((resolve) => {
    const existing = pick();
    if (existing) return resolve(existing);
    const el = document.createElement("script");
    el.src = src;
    el.onload = () => resolve(pick() || null);
    el.onerror = () => resolve(null);
    document.body.appendChild(el);
  });

let loading = null;

/**
 * google.maps with the places and geocoding libraries ready, or null. Only
 * called when a picker opens, so a visitor who never opens it costs nothing.
 * One attempt per page load: a failure leaves GPS and the area chips.
 */
export function loadGoogle(key) {
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  if (!loading) {
    const src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`;
    loading = loadScript(src, () => (window.google?.maps?.importLibrary ? window.google.maps : null)).then(
      async (maps) => {
        if (!maps) return null;
        try {
          await Promise.all([maps.importLibrary("places"), maps.importLibrary("geocoding")]);
          return maps;
        } catch {
          return null;
        }
      },
    );
  }
  return loading;
}

/**
 * One autocomplete session: suggestions are free within it and the closing
 * Place Details call is billed once. fetchFields ends it, so a new token is
 * made for the next search.
 */
export function newSessionToken() {
  try {
    return new window.google.maps.places.AutocompleteSessionToken();
  } catch {
    return undefined;
  }
}

/**
 * Suggestions in India, nudged toward `bias` (rounded to ~1 km: a nudge does
 * not need the customer's exact point). [{ id, main, secondary, prediction }].
 */
export async function suggestPlaces(q, { sessionToken, bias } = {}) {
  try {
    const { AutocompleteSuggestion } = await window.google.maps.importLibrary("places");
    const near =
      bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lng)
        ? { center: { lat: Math.round(bias.lat * 100) / 100, lng: Math.round(bias.lng * 100) / 100 }, radius: 50000 }
        : undefined;
    const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: q,
      sessionToken,
      includedRegionCodes: ["in"],
      ...(near ? { locationBias: near } : {}),
    });
    return (suggestions || [])
      .map((s) => s.placePrediction)
      .filter(Boolean)
      .map((p) => ({
        id: p.placeId,
        main: p.mainText?.text || p.text?.text || "",
        secondary: p.secondaryText?.text || "",
        prediction: p,
      }));
  } catch {
    return [];
  }
}

/**
 * The chosen suggestion as a Loc, or null. Only location and formattedAddress
 * are asked for: displayName would move the call to a dearer SKU. The label
 * is the suggestion's main text ("Salt Lake Sector V"), as the customer saw it.
 */
export async function placeToLoc(prediction) {
  try {
    const place = prediction.toPlace();
    await place.fetchFields({ fields: ["location", "formattedAddress"] });
    const lat = place.location?.lat();
    const lng = place.location?.lng();
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
      lat,
      lng,
      label: prediction.mainText?.text || prediction.text?.text || "Selected location",
      address: place.formattedAddress || "",
      source: "places",
    };
  } catch {
    return null;
  }
}

/** "Bidhannagar, Kolkata" for a GPS fix, or "" (the caller says "Current location"). */
export async function reverseGeocode({ lat, lng }) {
  try {
    const { Geocoder } = await window.google.maps.importLibrary("geocoding");
    const { results } = await new Geocoder().geocode({ location: { lat, lng } });
    const parts = results?.[0]?.address_components || [];
    const pick = (type) => parts.find((c) => c.types?.includes(type))?.long_name || "";
    const area = pick("sublocality_level_1") || pick("sublocality") || pick("neighborhood");
    const city = pick("locality");
    const label = [...new Set([area, city].filter(Boolean))].join(", ");
    return label || (results?.[0]?.formatted_address || "").split(",")[0].trim();
  } catch {
    return "";
  }
}

/**
 * A GPS fix as checkout address fields: { line1, city, postalCode, label }
 * from the nearest result, or null. label is as reverseGeocode's, so one
 * geocode call serves both. line1 is the street and area ("12, Park Street,
 * Park Circus"); the flat number is left to the customer.
 */
export async function reverseGeocodeAddress({ lat, lng }) {
  try {
    const { Geocoder } = await window.google.maps.importLibrary("geocoding");
    const { results } = await new Geocoder().geocode({ location: { lat, lng } });
    const first = results?.[0];
    if (!first) return null;
    const parts = first.address_components || [];
    const pick = (type) => parts.find((c) => c.types?.includes(type))?.long_name || "";
    const city = pick("locality") || pick("administrative_area_level_3") || pick("administrative_area_level_2");
    const postalCode = pick("postal_code").replace(/\D/g, "").slice(0, 6);
    const street = [pick("street_number"), pick("premise"), pick("route"), pick("sublocality_level_2"), pick("sublocality_level_1") || pick("neighborhood")];
    let line1 = [...new Set(street.filter(Boolean))].join(", ");
    if (!line1) {
      // No parts: the formatted address up to the city.
      const segs = (first.formatted_address || "").split(",").map((s) => s.trim());
      const cut = segs.findIndex((s) => s === city);
      line1 = segs.slice(0, cut > 0 ? cut : Math.max(1, segs.length - 3)).join(", ");
    }
    const area = pick("sublocality_level_1") || pick("sublocality") || pick("neighborhood");
    const label = [...new Set([area, city].filter(Boolean))].join(", ");
    return { line1: line1.slice(0, 200), city, postalCode, label };
  } catch {
    return null;
  }
}

/**
 * The same fields from OpenStreetMap's Nominatim, for when no Google key is
 * installed: one request per customer tap (well inside its 1 request/second
 * policy), the browser's Referer identifying the site. null on any failure.
 */
export async function osmReverseAddress({ lat, lng }) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const a = (await res.json())?.address;
    if (!a) return null;
    const area = a.suburb || a.neighbourhood || a.quarter || a.city_district || "";
    const city = a.city || a.town || a.village || a.county || a.state_district || "";
    const line1 = [...new Set([a.house_number, a.building, a.road, a.neighbourhood, area].filter(Boolean))].join(", ");
    if (!line1) return null;
    return {
      line1: line1.slice(0, 200),
      city,
      postalCode: String(a.postcode || "").replace(/\D/g, "").slice(0, 6),
      label: [...new Set([area, city].filter(Boolean))].join(", "),
      osm: true, // ODbL: the page credits OpenStreetMap wherever this is shown
    };
  } catch {
    return null;
  }
}
