import React, { useEffect, useRef, useState } from "react";
import { getEatsConfig } from "../../https/eatsApi";
import { loadScript } from "../../utils/cashfree";
import { isShortMapsLink, latLngFromMapsUrl } from "../../utils/mapsLink";

/** Middle of India, for a store that has no pin yet. */
const INDIA = { lat: 22.9734, lng: 78.6569 };

/**
 * Maps JS with the browser key from /api/eats/config, or null. The key is
 * never in the bundle or a VITE_ variable; without one (or on any failure)
 * the picker falls back to pasting a link, so this never throws.
 */
const loadMaps = async () => {
  try {
    const key = (await getEatsConfig())?.data?.data?.maps?.browserKey;
    if (!key) return null;
    const maps = await loadScript(
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&v=weekly`,
      () => (window.google?.maps?.importLibrary ? window.google.maps : null),
    );
    if (!maps) return null;
    const [{ Map }, places] = await Promise.all([maps.importLibrary("maps"), maps.importLibrary("places")]);
    return { Map, places, event: maps.event };
  } catch {
    return null;
  }
};

/**
 * Store Properties > "Pick on map". Drag the map under a fixed centre pin
 * (no Marker API, no mapId), or search a place to jump there. Mounted only
 * while open, so every open starts clean.
 */
const MapPinPicker = ({ initial, mapsLink, onPick, onClose }) => {
  const [status, setStatus] = useState("loading"); // loading | ready | none
  const start = useRef(latLngFromMapsUrl(`${initial?.lat ?? ""},${initial?.lng ?? ""}`));
  const [center, setCenter] = useState(start.current || INDIA);
  const g = useRef(null);
  const mapDiv = useRef(null);
  const map = useRef(null);
  const token = useRef(null);
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [paste, setPaste] = useState("");
  const [pasteErr, setPasteErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    // A key that is wrong or not allowed for this site loads fine and fails
    // later; Google reports that only through this global.
    window.gm_authFailure = () => setStatus("none");
    loadMaps().then((loaded) => {
      if (cancelled) return;
      g.current = loaded;
      setStatus(loaded ? "ready" : "none");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !mapDiv.current) return undefined;
    const m = new g.current.Map(mapDiv.current, {
      center: start.current || INDIA,
      zoom: start.current ? 17 : 5,
      gestureHandling: "greedy",
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
    });
    map.current = m;
    m.addListener("idle", () => {
      const c = m.getCenter();
      setCenter({ lat: c.lat(), lng: c.lng() });
    });
    return () => {
      g.current?.event?.clearInstanceListeners(m);
      map.current = null;
    };
  }, [status]);

  // Places Autocomplete (New), same calls as Knot Eats: 300 ms debounce,
  // 3+ characters, one session token until a place is fetched.
  useEffect(() => {
    const places = g.current?.places;
    if (status !== "ready" || !places || q.trim().length < 3) {
      setSuggestions([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        token.current ||= new places.AutocompleteSessionToken();
        const res = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q.trim(),
          sessionToken: token.current,
          includedRegionCodes: ["in"],
          locationBias: map.current?.getBounds() || undefined,
        });
        setSuggestions((res?.suggestions || []).map((s) => s.placePrediction).filter(Boolean).slice(0, 5));
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, status]);

  const choose = async (prediction) => {
    setQ("");
    try {
      const place = prediction.toPlace();
      // Only these two fields: displayName would bill a higher SKU.
      await place.fetchFields({ fields: ["location", "formattedAddress"] });
      if (place.location && map.current) {
        map.current.setCenter(place.location);
        map.current.setZoom(18);
      }
    } catch {
      /* the owner can still drag the map */
    } finally {
      token.current = null; // fetchFields ends the session
    }
  };

  const pick = ({ lat, lng }) => {
    onPick({ lat: lat.toFixed(6), lng: lng.toFixed(6) });
    onClose();
  };

  const applyText = (text) => {
    const p = latLngFromMapsUrl(text);
    if (p) return pick(p);
    setPasteErr(
      isShortMapsLink(text)
        ? "Open the link and copy the full address-bar URL."
        : "No location found. Paste a full Google Maps link or 'lat, lng'.",
    );
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick the store's map pin"
        className="w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[15px] font-extrabold text-[#0F172A]">Pick on map</p>
          <button type="button" onClick={onClose} className="h-9 px-3 rounded-xl border border-[#E2E8F0] text-[12.5px] font-bold text-[#334155]">
            Close
          </button>
        </div>

        {status === "loading" && <p className="py-10 text-center text-[13px] text-[#94A3B8]">Loading map…</p>}

        {status === "ready" && (
          <>
            <div className="relative">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your store's area or address"
                aria-label="Search a place"
                className="w-full h-[40px] px-3 rounded-xl border border-[#E2E8F0] text-[13px] font-bold"
              />
              {suggestions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E2E8F0] rounded-xl shadow-lg overflow-hidden">
                  {suggestions.map((p, i) => (
                    <li key={p.placeId || i}>
                      <button
                        type="button"
                        onClick={() => choose(p)}
                        className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-[#F8FAFC]"
                      >
                        <span className="font-bold text-[#0F172A]">{p.mainText?.text || p.text?.text}</span>
                        {p.secondaryText?.text ? <span className="text-[#64748B]"> · {p.secondaryText.text}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="relative h-[300px] sm:h-[360px] rounded-xl overflow-hidden border border-[#E2E8F0]">
              <div ref={mapDiv} className="absolute inset-0" />
              {/* The pin stays put; the map moves under it. Its tip is the centre. */}
              <svg
                aria-hidden="true"
                width="32"
                height="40"
                viewBox="0 0 24 30"
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full"
              >
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 18 12 18s12-9 12-18C24 5.4 18.6 0 12 0z" fill="#FD5302" />
                <circle cx="12" cy="12" r="4.5" fill="#fff" />
              </svg>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[12.5px] font-bold text-[#334155] tabular-nums">
                {center.lat.toFixed(6)}, {center.lng.toFixed(6)}
              </p>
              <button
                type="button"
                onClick={() => pick(center)}
                className="h-[38px] px-4 rounded-xl bg-[#FD5302] text-white text-[13px] font-bold hover:bg-[#D64502]"
              >
                Use this pin
              </button>
            </div>
          </>
        )}

        {status !== "loading" && (
          <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
            <label className="text-[11.5px] font-bold text-[#94A3B8]" htmlFor="pin-paste">
              Paste a Google Maps link or &apos;lat, lng&apos;
            </label>
            <div className="flex gap-2">
              <input
                id="pin-paste"
                value={paste}
                onChange={(e) => {
                  setPaste(e.target.value);
                  setPasteErr("");
                }}
                placeholder="https://www.google.com/maps/@22.5726,88.3639,17z"
                className="flex-1 min-w-0 h-[38px] px-3 rounded-xl border border-[#E2E8F0] text-[13px] font-bold"
              />
              <button
                type="button"
                onClick={() => applyText(paste)}
                className="h-[38px] px-3.5 rounded-xl bg-[#0F172A] text-white text-[12.5px] font-bold"
              >
                Use
              </button>
            </div>
            {mapsLink ? (
              <button type="button" onClick={() => applyText(mapsLink)} className="text-[12px] font-bold text-[#C2410C] underline underline-offset-2">
                Read from the Google Maps Link field
              </button>
            ) : null}
            {pasteErr && <p role="alert" className="text-[12px] font-bold text-[#DC2626]">{pasteErr}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default MapPinPicker;
