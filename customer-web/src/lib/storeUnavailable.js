/**
 * Is this storefront error "the store is there but not open online"?
 *
 * The backend (services/storefrontResolver.js) refuses a locked, closed or
 * website-off store: /api/storefront answers 403 with a `code`, and the
 * by-domain bootstrap collapses the same refusal into a 404 that keeps the
 * reason's message. Either way the diner gets a calm "temporarily
 * unavailable" page, never "not found" or "something went wrong".
 */
const CODES = ["STORE_UNAVAILABLE", "WEBSITE_DISABLED", "STORE_CLOSED", "ORDERING_PAUSED"];

export function isStoreUnavailable(error) {
  if (!error) return false;
  if (CODES.includes(error.code) || error.status === 403) return true;
  return /unavailable|temporarily closed/i.test(error.message || "");
}
