/**
 * Per-takeaway session cookies.
 *
 * Every takeaway's POS is served from one host and talks to one API host, so
 * the session cookie used to be a single `accessToken` in a single cookie jar
 * entry. Cookies are keyed by (name, domain, path) and know nothing about
 * stores, so two takeaways open in one browser shared ONE session: signing
 * into the second overwrote the first, and signing out of either cleared the
 * cookie for both. That is the "sessions sync across takeaways" report.
 *
 * The fix is to namespace the cookie by store: `accessToken_322623`. The jar
 * then holds one entry per takeaway, the browser sends them all, and each
 * request says which one it means via the `x-store-id` header. Signing out of
 * one clears only that store's pair; the others keep working.
 *
 * A request that declares no store falls back to the legacy unnamespaced
 * cookie. That is deliberate and must stay: it is what keeps everyone who is
 * already signed in from being kicked out the moment this deploys, and what
 * keeps non-browser callers working.
 */

const LEGACY_ACCESS = "accessToken";
const LEGACY_REFRESH = "refreshToken";

/** Store IDs are 6-digit strings. Anything else is not allowed near a cookie name. */
const normalizeStoreKey = (value) => {
  const s = String(value == null ? "" : value).trim();
  return /^\d{6}$/.test(s) ? s : "";
};

const accessCookieName = (storeId) => {
  const key = normalizeStoreKey(storeId);
  return key ? `${LEGACY_ACCESS}_${key}` : LEGACY_ACCESS;
};

const refreshCookieName = (storeId) => {
  const key = normalizeStoreKey(storeId);
  return key ? `${LEGACY_REFRESH}_${key}` : LEGACY_REFRESH;
};

/** Which takeaway is this request acting as? Declared by the client per tab. */
const storeKeyFromRequest = (req) => {
  const header = req?.headers?.["x-store-id"];
  return normalizeStoreKey(Array.isArray(header) ? header[0] : header);
};

/**
 * Read one of the session cookies for the takeaway this request declares.
 *
 * Order matters:
 *   1. the declared store's namespaced cookie -- the normal path;
 *   2. the legacy unnamespaced cookie -- a session predating this change;
 *   3. a lone namespaced cookie when the client declared nothing, so a client
 *      that has not been updated still works while exactly one takeaway is
 *      signed in. With two or more signed in we refuse to guess, because
 *      guessing is precisely the bug being fixed.
 */
const readSessionCookie = (req, kind) => {
  const cookies = req?.cookies || {};
  const base = kind === "refresh" ? LEGACY_REFRESH : LEGACY_ACCESS;
  const key = storeKeyFromRequest(req);

  if (key) {
    const scoped = cookies[`${base}_${key}`];
    if (typeof scoped === "string" && scoped) return scoped;
    // The tab named a store it holds no cookie for. Falling through to the
    // legacy cookie here is safe (it is that browser's own session) but must
    // NOT fall through to another store's cookie.
  }

  if (typeof cookies[base] === "string" && cookies[base]) return cookies[base];

  if (!key) {
    const scopedNames = Object.keys(cookies).filter(
      (n) => n.startsWith(`${base}_`) && normalizeStoreKey(n.slice(base.length + 1)),
    );
    if (scopedNames.length === 1) {
      const only = cookies[scopedNames[0]];
      if (typeof only === "string" && only) return only;
    }
  }

  return "";
};

const readAccessToken = (req) => readSessionCookie(req, "access");
const readRefreshToken = (req) => readSessionCookie(req, "refresh");

/**
 * Cookie names a sign-out should clear.
 *
 * This store's own pair always goes. The legacy unnamespaced pair goes ONLY
 * when it is what authenticated this request -- during the rollout another
 * takeaway may still be riding that same legacy cookie, and clearing it
 * because an unrelated store signed out would be the very bug being fixed.
 * When the legacy cookie IS this session, it must be cleared: leaving it
 * would mean "sign out" did not actually sign anyone out.
 */
const cookieNamesToClear = (req, storeId) => {
  const key = normalizeStoreKey(storeId);
  const cookies = req?.cookies || {};
  const names = [];

  if (key) {
    names.push(
      { name: `${LEGACY_ACCESS}_${key}`, path: "/" },
      { name: `${LEGACY_REFRESH}_${key}`, path: "/api/user" },
    );
  }

  const hasScoped = key && Boolean(cookies[`${LEGACY_ACCESS}_${key}`] || cookies[`${LEGACY_REFRESH}_${key}`]);
  if (!hasScoped) {
    names.push(
      { name: LEGACY_ACCESS, path: "/" },
      { name: LEGACY_REFRESH, path: "/api/user" },
    );
  }

  return names;
};

module.exports = {
  LEGACY_ACCESS,
  LEGACY_REFRESH,
  normalizeStoreKey,
  accessCookieName,
  refreshCookieName,
  storeKeyFromRequest,
  readAccessToken,
  readRefreshToken,
  cookieNamesToClear,
};
