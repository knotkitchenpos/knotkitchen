/**
 * The store's own visitor analytics: Google Analytics 4 and/or the Meta
 * Pixel, with the IDs the owner entered in Manage Website.
 *
 * Both set cookies, so nothing loads until the visitor accepts the banner
 * (components/ConsentBanner.jsx); the choice is kept per store in this
 * browser. The site is a single-page app, so page views are sent by hand on
 * every change of page, and a paid order is sent as a purchase.
 */

const KEY = (slug) => `kk_consent:${slug || "default"}`;

export const readConsent = (slug) => {
  try {
    return window.localStorage.getItem(KEY(slug)) || "";
  } catch {
    return "";
  }
};

export const writeConsent = (slug, value) => {
  try {
    window.localStorage.setItem(KEY(slug), value);
  } catch {
    /* private mode: asked again next visit */
  }
};

export const hasAnalytics = (a) => Boolean(a && (a.ga4Id || a.metaPixelId));

const loaded = { ga4: "", pixel: "" };

const addScript = (src) => {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
};

/** Load the trackers configured for this store. Safe to call again. */
export const startAnalytics = ({ ga4Id, metaPixelId } = {}) => {
  if (ga4Id && loaded.ga4 !== ga4Id) {
    loaded.ga4 = ga4Id;
    window.dataLayer = window.dataLayer || [];
    // gtag must push `arguments` itself, as Google's snippet does.
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    // Page views are sent per page change (trackPage), not on load.
    window.gtag("config", ga4Id, { send_page_view: false });
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4Id)}`);
  }
  if (metaPixelId && loaded.pixel !== metaPixelId) {
    loaded.pixel = metaPixelId;
    if (!window.fbq) {
      // Meta's standard loader: queue calls until fbevents.js arrives.
      const fbq = function fbq() {
        if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
        else fbq.queue.push(arguments);
      };
      fbq.push = fbq;
      fbq.loaded = true;
      fbq.version = "2.0";
      fbq.queue = [];
      window.fbq = fbq;
      window._fbq = fbq;
      addScript("https://connect.facebook.net/en_US/fbevents.js");
    }
    window.fbq("init", metaPixelId);
  }
};

export const trackPage = () => {
  window.gtag?.("event", "page_view", {
    page_location: window.location.href,
    page_path: window.location.pathname,
    page_title: document.title,
  });
  window.fbq?.("track", "PageView");
};

export const trackPurchase = ({ id, value, currency = "INR" }) => {
  window.gtag?.("event", "purchase", { transaction_id: String(id || ""), value: Number(value) || 0, currency });
  window.fbq?.("track", "Purchase", { value: Number(value) || 0, currency });
};
