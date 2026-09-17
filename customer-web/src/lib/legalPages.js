/**
 * The five legal pages every restaurant website carries, and their paths.
 *
 * Keys are the URL segment after `/legal/`; titles are what the footer and
 * the page header print. The text itself lives in pages/LegalPage.jsx.
 */
export const LEGAL_PAGES = Object.freeze([
  { key: "terms", title: "Terms & Conditions", short: "Terms" },
  { key: "privacy", title: "Privacy Policy", short: "Privacy" },
  { key: "refund-cancellation", title: "Refund & Cancellation Policy", short: "Refunds" },
  { key: "return", title: "Return Policy", short: "Returns" },
  { key: "shipping-delivery", title: "Shipping & Delivery Policy", short: "Delivery" },
]);

export const legalPage = (key) => LEGAL_PAGES.find((p) => p.key === key) || null;
