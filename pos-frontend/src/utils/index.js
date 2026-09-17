export const getAvatarName = (name) => {
  if(!name) return "";

  return name.split(" ").map(word => word[0]).join("").toUpperCase();

}

/** "September 17, 2026" (the Home greeting). */
export const formatDate = (date) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return `${months[date.getMonth()]} ${String(date.getDate()).padStart(2, '0')}, ${date.getFullYear()}`;
};

/*
 * Money and dates, one definition each. Two money shapes exist on purpose:
 * the till screens print "₹1234.50" (no grouping), receipts and cash
 * reports print "₹1,234.50" (Indian grouping); the receipt test pins the
 * second. Pick by screen, never re-declare.
 */

/** "₹1234.50" -- two decimals, no grouping. `symbol` for the QR/online pages that carry their own. */
export const money = (n, symbol = "₹") => `${symbol}${(Number(n) || 0).toFixed(2)}`;

/** "₹1,234.50" -- Indian grouping, two decimals. */
export const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "17 Sep 2026" */
export const dateGB = (d) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** "02:45 PM" */
export const time12 = (d) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

/** "2:45 pm", or "" when there is no date. */
export const timeIN = (d) =>
  d ? new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "";

/** "17 Sep, 02:45 pm", or "" when there is no date. */
export const dateTimeIN = (d) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** LOCAL-timezone YYYY-MM-DD. `.toISOString()` would drift for non-UTC tz. */
export const localDay = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
