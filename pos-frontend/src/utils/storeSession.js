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
