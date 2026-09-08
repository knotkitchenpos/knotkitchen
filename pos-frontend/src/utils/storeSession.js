/**
 * Which takeaway is THIS tab signed into?
 *
 * The POS for every takeaway is served from one host and talks to one API
 * host, so a single cookie jar entry used to serve them all: signing into a
 * second takeaway overwrote the first, and signing out of either signed out
 * both. Session cookies are now namespaced per store on the server, and every
 * request has to say which takeaway it means.
 *
 * That identity is kept in sessionStorage, which is per TAB. Two tabs on two
 * takeaways therefore stay independent even though they share a cookie jar.
 *
 * localStorage holds the last store signed into, purely as the seed for a
 * newly opened tab -- without it, every new tab would land on the sign-in
 * screen even though its session cookie is sitting right there. A tab that has
 * its own value always ignores the seed, so the seed can never drag one tab
 * onto another takeaway's session.
 */

const TAB_KEY = "posStoreId";
const SEED_KEY = "posLastStoreId";

const isStoreId = (v) => /^\d{6}$/.test(String(v == null ? "" : v).trim());

/** Read this tab's takeaway, falling back to the last-used seed once. */
export const getActiveStoreId = () => {
  try {
    const tab = sessionStorage.getItem(TAB_KEY);
    if (isStoreId(tab)) return String(tab).trim();

    const seed = localStorage.getItem(SEED_KEY);
    if (isStoreId(seed)) {
      // Claim the seed for this tab so a later sign-in elsewhere cannot move
      // this tab onto a different takeaway mid-session.
      sessionStorage.setItem(TAB_KEY, String(seed).trim());
      return String(seed).trim();
    }
  } catch {
    /* storage can throw in private modes; treat as "no store" */
  }
  return "";
};

/** Bind this tab to a takeaway. Called on sign-in and on CSD handoff. */
export const setActiveStoreId = (storeId) => {
  if (!isStoreId(storeId)) return;
  const value = String(storeId).trim();
  try {
    sessionStorage.setItem(TAB_KEY, value);
    localStorage.setItem(SEED_KEY, value);
  } catch {
    /* non-fatal: the request just falls back to the legacy cookie */
  }
};

/**
 * Release this tab on sign-out.
 *
 * The seed is cleared too, so the next new tab does not present a takeaway
 * whose cookie has just been deleted. Other OPEN tabs keep their own
 * sessionStorage and are untouched -- that is the whole point.
 */
export const clearActiveStoreId = () => {
  try {
    sessionStorage.removeItem(TAB_KEY);
    localStorage.removeItem(SEED_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * A localStorage key that belongs to ONE store.
 *
 * Anything a store's staff build up locally -- custom modifier groups, custom
 * table areas -- was stored under a bare key, so the browser handed the same
 * list to every store the user opened. Creating a second takeaway showed the
 * first one's groups already filled in, and editing them in one place changed
 * both.
 *
 * Unscoped keys stay readable ONLY through this helper's fallback so an
 * operator's existing lists survive the change; anything written from now on
 * is scoped.
 */
export const storeScopedKey = (key) => {
  const storeId = getActiveStoreId();
  return storeId ? `${key}:${storeId}` : key;
};

export const readStoreScoped = (key, fallback) => {
  try {
    const scoped = localStorage.getItem(storeScopedKey(key));
    // Fall back to the old unscoped value once, so nothing an operator
    // already built disappears the first time they open the screen.
    const raw = scoped !== null ? scoped : localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const writeStoreScoped = (key, value) => {
  try {
    localStorage.setItem(storeScopedKey(key), JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
};
