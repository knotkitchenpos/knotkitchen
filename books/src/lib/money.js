// Money in rupees, rounded to paise. Indian grouping: 1,23,456.00.

export const r2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

const fmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inr = (n) => (n < 0 ? "-₹" : "₹") + fmt.format(Math.abs(r2(n)));
// For the PDF: its built-in fonts have no ₹ glyph.
export const rs = (n) => (n < 0 ? "-Rs. " : "Rs. ") + fmt.format(Math.abs(r2(n)));
export const num = (n) => fmt.format(r2(n));

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`);
const below1000 = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? below100(rest) : ""].filter(Boolean).join(" ");
};

// Indian system: crore, lakh, thousand, hundred.
const intWords = (n) => {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${intWords(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(" ");
};

export const amountInWords = (amount) => {
  const total = r2(amount);
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  return `Rupees ${intWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ""} Only`;
};
