/**
 * The money and date formatters every CSD screen shares. One place, so a
 * number reads the same on Dashboard, Reports and a restaurant's page.
 */
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const INR_WHOLE = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("en-IN");

/** ₹1,234.50 */
export const inr = (n) => INR.format(n || 0);
/** ₹1,235 -- dashboards and reports, where paise are noise. */
export const inrWhole = (n) => INR_WHOLE.format(n || 0);
/** 1,234 */
export const num = (n) => NUM.format(n || 0);

/** "17 Sept 2026, 4:05 pm", or a dash. */
export const dt = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
/** Same, but "Never" when there is no date (last-login style fields). */
export const dtOrNever = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never");
/** "17 Sept 2026", or a dash. */
export const dOnly = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—");
