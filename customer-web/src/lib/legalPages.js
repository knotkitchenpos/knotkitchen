/**
 * The five legal pages every restaurant website carries, and their paths.
 *
 * Keys are the URL segment after `/legal/`; titles are what the footer and
 * the page header print. The text itself lives in pages/LegalPage.jsx.
 */
export const LEGAL_PAGES = Object.freeze([
  { key: "terms", title: "Terms & Conditions" },
  { key: "privacy", title: "Privacy Policy" },
  { key: "refund-cancellation", title: "Refund & Cancellation Policy" },
  { key: "return", title: "Return Policy" },
  { key: "shipping-delivery", title: "Shipping & Delivery Policy" },
]);

export const legalPage = (key) => LEGAL_PAGES.find((p) => p.key === key) || null;
