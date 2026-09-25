/**
 * The <head> of a store website page, for the bots that read it without
 * running JavaScript: search engines on first pass, and the link previews of
 * WhatsApp, Facebook, X and the like.
 *
 * The store website is a single-page app, so its index.html is the same for
 * every store and every page ("Order Online"). customer-web's nginx pulls this
 * fragment into index.html with an SSI include (customer-web/nginx.conf), so
 * each page arrives with its own title, description, canonical link, Open
 * Graph / Twitter card, icons and, on the home page, the restaurant's
 * schema.org record. The app keeps the title in step as the customer moves
 * around (customer-web/src/hooks/useThemeVars.js).
 */

const fs = require("fs");
const path = require("path");
const { resolveStorefront } = require("./storefrontResolver");
const { mergedContact } = require("./websitePublicInfo");

// Keys and titles as customer-web/src/lib/legalPages.js.
const LEGAL = Object.freeze({
  terms: "Terms & Conditions",
  privacy: "Privacy Policy",
  "refund-cancellation": "Refund & Cancellation Policy",
  return: "Return Policy",
  "shipping-delivery": "Shipping & Delivery Policy",
});

const DEFAULT_TITLE = "Order Online";
const DEFAULT_DESCRIPTION = "Order delicious food online — powered by KnotKitchen.";

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Which page a path is, as the app routes it (customer-web/src/lib/landingRoute.js):
 * home, menu, a legal page, or not a page at all. `/s/<slug>` is the
 * path-based mount used for previews.
 */
const parsePath = (raw) => {
  const pathOnly = String(raw || "/").split(/[?#]/)[0] || "/";
  const m = pathOnly.match(/^\/s\/([a-z0-9-]+)(\/.*)?$/i);
  const slug = m ? m[1].toLowerCase() : "";
  const rest = (m ? m[2] || "" : pathOnly).replace(/\/+$/, "");
  let page = "notfound";
  let legalKey = "";
  if (rest === "") page = "home";
  else if (rest === "/menu") page = "menu";
  else {
    const legal = rest.match(/^\/legal\/([a-z0-9-]+)$/);
    if (legal && LEGAL[legal[1]]) {
      page = "legal";
      legalKey = legal[1];
    }
  }
  return { slug, page, legalKey, cleanPath: rest || "/" };
};

/** An uploaded photo at a size a preview can fetch quickly; other URLs as they are. */
const sized = (url, w) => (/\/uploads\/[^?]+\.(webp|png|jpe?g)$/i.test(url || "") ? `${url}?w=${w}` : url || "");

/**
 * Whether a photo can actually be served. An upload whose original was
 * deleted still has its record on the website settings, and its ?w= copy is
 * made from the original -- a preview pointing at it gets a 404. A photo
 * stored elsewhere (a URL not under our /uploads) is taken as it is.
 */
const servable = (url, w) => {
  const m = String(url || "").match(/\/uploads\/([^?#]+)$/);
  if (!m) return Boolean(url);
  const root = path.resolve(require("../config/config").uploadsDir || "uploads");
  let file;
  try {
    file = path.resolve(root, decodeURIComponent(m[1]));
  } catch {
    return false;
  }
  if (!file.startsWith(root + path.sep)) return false;
  return fs.existsSync(file) || fs.existsSync(`${file}.w${w}.webp`);
};

/** The first photo in the list that can be served, at width w. */
const firstServable = (urls, w, exists) => {
  for (const u of urls) if (u && exists(u, w)) return sized(u, w);
  return "";
};

const cleanHost = (h) => String(h || "").trim().toLowerCase().replace(/:\d+$/, "").replace(/[^a-z0-9.-]/g, "");

/** The fragment for one page. Never throws: an unknown store gets the defaults, marked noindex. */
const buildHead = ({ host, path: pagePath, result, exists = servable }) => {
  const h = cleanHost(host);
  const { slug, page, legalKey, cleanPath } = parsePath(pagePath);
  const lines = [];
  const meta = (name, content) => content && lines.push(`<meta name="${name}" content="${esc(content)}" />`);
  const prop = (p, content) => content && lines.push(`<meta property="${p}" content="${esc(content)}" />`);

  if (!result?.ok) {
    lines.push(`<title>${esc(DEFAULT_TITLE)}</title>`);
    meta("description", DEFAULT_DESCRIPTION);
    meta("robots", "noindex");
    return lines.join("\n    ");
  }

  const { settings, store, restaurant } = result;
  const branding = settings.branding || {};
  const name = settings.displayName || store?.storeName || restaurant?.name || DEFAULT_TITLE;
  const contact = mergedContact(settings, restaurant);
  const city = String(contact.city || "").split(",")[0].trim();
  const ways = [settings.ordering?.pickupEnabled !== false ? "pickup" : "", settings.ordering?.deliveryEnabled ? "delivery" : ""]
    .filter(Boolean)
    .join(" and ");
  const about =
    branding.siteDescription ||
    `Order online from ${name}${city ? ` in ${city}` : ""}${ways ? ` for ${ways}` : ""}.`;

  const title =
    page === "home"
      ? branding.siteTitle || name
      : page === "menu"
        ? `Menu | ${name}`
        : page === "legal"
          ? `${LEGAL[legalKey]} | ${name}`
          : `Page not found | ${name}`;
  const description =
    page === "menu"
      ? `See the full menu of ${name} and order online${ways ? ` for ${ways}` : ""}.`
      : page === "legal"
        ? `${LEGAL[legalKey]} of ${name}.`
        : about;
  const url = `https://${h}${cleanPath === "/" ? "/" : cleanPath}`;
  const image =
    firstServable([settings.landing?.backgroundImage?.url, branding.coverImage?.url], 1280, exists) ||
    firstServable([branding.logo?.url], 640, exists) ||
    `https://${h}/og-image.png`;
  const imageAlt = settings.landing?.backgroundImage?.alt || branding.coverImage?.alt || name;
  const icon = firstServable([branding.favicon?.url], 160, exists) || firstServable([branding.logo?.url], 160, exists);

  lines.push(`<title>${esc(title)}</title>`);
  meta("description", description);
  // The /s/<slug> preview mount duplicates the store's own host; a page that
  // does not exist is not one to index either.
  if (slug || page === "notfound") meta("robots", "noindex");
  else lines.push(`<link rel="canonical" href="${esc(url)}" />`);
  if (settings.theme?.colors?.primary) meta("theme-color", settings.theme.colors.primary);
  if (icon) {
    lines.push(`<link rel="icon" href="${esc(icon)}" />`);
    lines.push(`<link rel="apple-touch-icon" href="${esc(firstServable([branding.logo?.url], 320, exists) || icon)}" />`);
  }

  prop("og:type", "website");
  prop("og:site_name", name);
  prop("og:title", title);
  prop("og:description", description);
  prop("og:url", url);
  prop("og:image", image);
  prop("og:image:alt", imageAlt);
  meta("twitter:card", "summary_large_image");
  meta("twitter:title", title);
  meta("twitter:description", description);
  meta("twitter:image", image);

  // The restaurant, as search engines read it: name, address, phone, menu.
  if (page === "home") {
    const ld = {
      "@context": "https://schema.org",
      "@type": "Restaurant",
      name,
      url,
      image,
      ...(contact.phone ? { telephone: contact.phone } : {}),
      ...(contact.addressLine1 || city
        ? {
            address: {
              "@type": "PostalAddress",
              streetAddress: [contact.addressLine1, contact.addressLine2].filter(Boolean).join(", "),
              addressLocality: city,
              postalCode: contact.postalCode || "",
              addressCountry: "IN",
            },
          }
        : {}),
      hasMenu: `https://${h}/menu`,
    };
    // "</" can never close the script early.
    lines.push(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`);
  }
  return lines.join("\n    ");
};

// ponytail: per-process cache, fine for one API container; a shared cache if it is scaled out.
const TTL_MS = 60 * 1000;
const cache = new Map();

const headFor = async ({ host, path: pagePath }) => {
  const h = cleanHost(host);
  const { slug, page, legalKey } = parsePath(pagePath);
  // A real page's head depends only on the store and which page it is. A path
  // that is not a page names itself in og:url, so it is never cached (nor
  // can junk URLs fill the cache).
  const key = `${h}|${slug}|${page}|${legalKey}`;
  const hit = page === "notfound" ? null : cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.html;

  let result = null;
  try {
    result = h || slug ? await resolveStorefront({ identifier: slug, host: h }) : null;
  } catch (err) {
    console.warn("[storeHead] resolve failed:", err.message);
  }
  const html = buildHead({ host: h, path: pagePath, result });
  if (cache.size > 5000) cache.clear();
  if (page !== "notfound") cache.set(key, { html, at: Date.now() });
  return html;
};

module.exports = { buildHead, headFor, parsePath, esc, LEGAL };
