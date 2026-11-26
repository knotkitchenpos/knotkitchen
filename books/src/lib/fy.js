// Indian financial year: 1 April to 31 March, labelled "2026-27".
// Dates are plain "YYYY-MM-DD" strings everywhere in the app.

export const fyOf = (date) => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const fyRange = (label) => {
  const start = Number(label.slice(0, 4));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
};

export const inFy = (date, label) => {
  const { from, to } = fyRange(label);
  return !!date && date >= from && date <= to;
};

// The 12 months of a financial year as "YYYY-MM", April first.
export const fyMonths = (label) => {
  const start = Number(label.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1;
    const y = m >= 4 ? start : start + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
};

// Q1 = Apr-Jun ... Q4 = Jan-Mar.
export const quarterMonths = (label, q) => fyMonths(label).slice((q - 1) * 3, q * 3);

export const quarterOf = (date) => Math.floor(((Number(date.slice(5, 7)) + 8) % 12) / 3) + 1;

export const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// A few years around today, newest first, for the selector.
export const fyChoices = (now = today()) => {
  const cur = Number(fyOf(now).slice(0, 4));
  return [cur + 1, cur, cur - 1, cur - 2, cur - 3].map((s) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`);
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;
export const dateLabel = (d) => (d ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : "");
