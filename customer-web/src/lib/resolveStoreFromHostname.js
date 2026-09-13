/**
 * resolveStoreFromHostname(hostname, options)
 * ---------------------------------------------------------------------------
 * The single entry point that turns a browser hostname into a Knot Kitchen
 * tenant identifier (§6 of the production spec). Every part of the customer
 * website goes through this helper — nothing else looks at window.location.
 *
 * Supported inputs:
 *
 *   burger-house.knotkitchen.com  →  { slug: "burger-house", mode: "subdomain" }
 *   burger-house.localhost        →  { slug: "burger-house", mode: "subdomain" }
 *   www.burgerhouse.com           →  { host: "burgerhouse.com", mode: "custom" }
 *   burgerhouse.com               →  { host: "burgerhouse.com", mode: "custom" }
 *   knotkitchen.com               →  { slug: fallback, mode: "apex" }
 *   127.0.0.1 / raw IP            →  { slug: fallback, mode: "ip" }
 *
 * The base-domain list (`bases`) is what allows the same code to work for
 * production (`knotkitchen.com`), dev (`localhost`), and any future domain
 * without a rebuild — we compare the hostname's suffix against every entry.
 *
 * SECURITY: this runs client-side and is used only to pick the correct
 * bootstrap URL. The backend re-validates the resolved slug/host in
 * resolveStorefront(), so a manipulated URL can never leak another store's
 * private data.
 */

const stripWww = (host) => host.replace(/^www\./, "");
const stripPort = (host) => host.split(":")[0].toLowerCase();
const isIpAddress = (host) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^[0-9a-f:]+$/i.test(host);

// Reserved subdomains that belong to the platform itself. If the customer-web
// container ever receives a request for one of these, we should show the
// generic apex/fallback page rather than trying to look up a store named
// "api" or "admin".
const PLATFORM_SUBDOMAINS = new Set([
  "www",
  "api",
  "admin",
  "admin-api",
  "pos",
  "app",
  "kds",
  "cdn",
  "static",
  "assets",
  "mail",
]);

/**
 * @param {string} hostname          — e.g. window.location.hostname
 * @param {object} options
 * @param {string[]} options.bases   — apex domains this platform is served under
 * @param {string}   [options.fallbackSlug]  — used for apex / IP visits
 * @returns {{ slug?: string, host?: string, mode: string, base?: string, raw: string }}
 */
export function resolveStoreFromHostname(hostname, { bases = [], fallbackSlug = "" } = {}) {
  const raw = String(hostname || "").trim();
  const host = stripWww(stripPort(raw));

  if (!host) return { mode: "empty", raw };

  if (isIpAddress(host)) {
    return fallbackSlug
      ? { slug: fallbackSlug, mode: "ip", raw }
      : { mode: "ip", raw };
  }

  const normalizedBases = bases
    .map((b) => stripWww(stripPort(String(b || "").trim())))
    .filter(Boolean);

  // Try each configured base longest-first so "app.knotkitchen.com" matches
  // the base "knotkitchen.com" rather than a shorter suffix. Ties broken
  // alphabetically for determinism.
  const sortedBases = [...normalizedBases].sort(
    (a, b) => b.length - a.length || a.localeCompare(b)
  );

  for (const base of sortedBases) {
    if (host === base) {
      // Apex visit (someone typed knotkitchen.com directly).
      return fallbackSlug
        ? { slug: fallbackSlug, mode: "apex", base, raw }
        : { mode: "apex", base, raw };
    }

    if (host.endsWith(`.${base}`)) {
      const prefix = host.slice(0, host.length - base.length - 1);
      // Multi-level subdomains ("shop.burger-house.knotkitchen.com") aren't
      // used by the platform today; take the LAST label so we don't accidentally
      // resolve to a wrong store.
      const parts = prefix.split(".").filter(Boolean);
      const slug = parts[parts.length - 1];

      if (!slug) {
        return fallbackSlug
          ? { slug: fallbackSlug, mode: "apex", base, raw }
          : { mode: "apex", base, raw };
      }
      if (PLATFORM_SUBDOMAINS.has(slug)) {
        return { mode: "platform", base, slug, raw };
      }
      return { slug, mode: "subdomain", base, raw };
    }
  }

  // Not one of our base domains — treat as a custom domain and let the backend
  // decide by matching WebsiteSettings.customDomain.
  return { host, mode: "custom", raw };
}

/**
 * Convenience wrapper that reads config from Vite env vars. Kept separate so
 * the pure resolver above is trivially testable.
 */
export function resolveStoreFromWindow() {
  const bases = String(import.meta.env.VITE_BASE_DOMAIN || "knotkitchen.com,localhost")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const fallbackSlug = String(import.meta.env.VITE_FALLBACK_SLUG || "").trim();
  return resolveStoreFromHostname(window.location.hostname, { bases, fallbackSlug });
}
