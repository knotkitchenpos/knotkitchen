/**
 * A store's map pin from whatever the owner pastes: a Google Maps URL or a
 * bare "lat, lng". The fallback for the map pin picker when there is no
 * browser key, and a shortcut when the owner already has a Maps link.
 *
 * Patterns are tried most precise first: `!3d…!4d…` is the dropped pin itself,
 * while `@lat,lng` is only where the map was centred when the link was copied.
 */
const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";
const PATTERNS = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(`[?&](?:q|query|ll|center|destination)=(?:loc:)?${NUM},\\s*${NUM}`),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`),
];

/** maps.app.goo.gl / goo.gl/maps: a redirect we cannot follow from here. */
export const isShortMapsLink = (text) => /(?:^|\/\/)(?:maps\.app\.goo\.gl|goo\.gl\/maps)\b/i.test(String(text || "").trim());

export const latLngFromMapsUrl = (text) => {
  let s = String(text || "");
  if (!s.trim() || isShortMapsLink(s)) return null;
  // Shared links often encode the comma (q=22.57%2C88.36).
  try {
    s = decodeURIComponent(s);
  } catch {
    /* a stray % — read it as typed */
  }
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    return null;
  }
  return null;
};
