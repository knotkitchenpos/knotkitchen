// GST returns: monthly summary with credit set-off, GSTR-1 sections, GSTR-3B lines, due dates.
import { r2 } from "./money.js";
import { isRegistered, expenseTax } from "./tax.js";
import { fyOf, quarterMonths, quarterOf } from "./fy.js";

// Inter-state B2C invoices above this go to B2CL (Table 5). Rule 59 limit, ₹1 lakh since 1 Aug 2024.
export const B2CL_LIMIT = 100000;

export const gstr1Section = (inv, firm) => {
  if (inv.totals?.type === "unregistered") return "";
  if ((inv.clientGstin || "").trim()) return "4A B2B";
  if (inv.totals?.type === "inter" && (inv.totals?.total || 0) > B2CL_LIMIT) return "5 B2CL";
  return "7 B2CS";
};

const ym = (d) => d.slice(0, 7);
const zero = () => ({ cgst: 0, sgst: 0, igst: 0 });

// Output tax and ITC for one month.
export const monthFigures = (month, invoices, expenses, firm) => {
  const out = zero();
  const itc = zero();
  let b2b = 0;
  let b2c = 0;
  for (const inv of invoices) {
    if (ym(inv.date) !== month || !isRegistered(firm, inv.date)) continue;
    const t = inv.totals || {};
    if ((inv.clientGstin || "").trim()) b2b += t.taxable || 0;
    else b2c += t.taxable || 0;
    out.cgst += t.cgst || 0;
    out.sgst += t.sgst || 0;
    out.igst += t.igst || 0;
  }
  for (const e of expenses) {
    if (ym(e.date) !== month) continue;
    const x = expenseTax(e, firm);
    itc.cgst += x.itc.cgst;
    itc.sgst += x.itc.sgst;
    itc.igst += x.itc.igst;
  }
  for (const o of [out, itc]) for (const k of Object.keys(o)) o[k] = r2(o[k]);
  return { month, b2b: r2(b2b), b2c: r2(b2c), out, itc };
};

/**
 * Set ITC (plus credit carried in) against output tax, in the order the law allows:
 * IGST credit → IGST, then CGST, then SGST; CGST credit → CGST, then IGST;
 * SGST credit → SGST, then IGST. CGST and SGST never cross. Returns cash to pay and credit left.
 */
export const setOff = (out, credit) => {
  const due = { ...out };
  const cr = { ...credit };
  const use = (from, to) => {
    const u = Math.min(cr[from], due[to]);
    cr[from] = r2(cr[from] - u);
    due[to] = r2(due[to] - u);
  };
  use("igst", "igst");
  use("igst", "cgst");
  use("igst", "sgst");
  use("cgst", "cgst");
  use("cgst", "igst");
  use("sgst", "sgst");
  use("sgst", "igst");
  return { cash: due, carry: cr };
};

// Month by month from the first month with data, carrying unused credit forward.
export const runningMonths = (invoices, expenses, firm, uptoMonth) => {
  const all = [...invoices, ...expenses].map((x) => x.date).filter(Boolean).sort();
  if (!all.length) return [];
  const rows = [];
  let [y, m] = all[0].slice(0, 7).split("-").map(Number);
  let carry = zero();
  for (;;) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    if (month > uptoMonth) break;
    const f = monthFigures(month, invoices, expenses, firm);
    const opening = carry;
    const credit = { cgst: r2(carry.cgst + f.itc.cgst), sgst: r2(carry.sgst + f.itc.sgst), igst: r2(carry.igst + f.itc.igst) };
    const s = setOff(f.out, credit);
    carry = s.carry;
    rows.push({ ...f, opening, cash: s.cash, carry: s.carry });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return rows;
};

export const quarterSummary = (fy, q, invoices, expenses, firm) => {
  const months = quarterMonths(fy, q);
  const rows = runningMonths(invoices, expenses, firm, months[2]);
  const byMonth = months.map((mo) => rows.find((r) => r.month === mo) || {
    ...monthFigures(mo, invoices, expenses, firm), opening: zero(), cash: zero(), carry: zero(),
  });
  const sum = (pick) => r2(byMonth.reduce((s, r) => s + pick(r), 0));
  const gstr3b = {
    "3.1(a)": {
      taxable: sum((r) => r.b2b + r.b2c),
      igst: sum((r) => r.out.igst), cgst: sum((r) => r.out.cgst), sgst: sum((r) => r.out.sgst),
    },
    "4(A)(5)": { igst: sum((r) => r.itc.igst), cgst: sum((r) => r.itc.cgst), sgst: sum((r) => r.itc.sgst) },
  };
  const invs = invoices
    .filter((i) => months.includes(ym(i.date)) && isRegistered(firm, i.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((i) => ({ inv: i, section: gstr1Section(i, firm) }));
  return { months: byMonth, gstr3b, invoices: invs };
};

const csvCell = (v) => {
  let s = String(v ?? "");
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

export const quarterCsv = (fy, q, summary) => {
  const rows = [["KnotKitchen Books", `FY ${fy}`, `Q${q}`], [],
    ["Month", "B2B taxable", "B2C taxable", "Output CGST", "Output SGST", "Output IGST", "ITC CGST", "ITC SGST", "ITC IGST", "Cash CGST", "Cash SGST", "Cash IGST", "Credit c/f CGST", "Credit c/f SGST", "Credit c/f IGST"]];
  for (const m of summary.months) {
    rows.push([m.month, m.b2b, m.b2c, m.out.cgst, m.out.sgst, m.out.igst, m.itc.cgst, m.itc.sgst, m.itc.igst,
      m.cash.cgst, m.cash.sgst, m.cash.igst, m.carry.cgst, m.carry.sgst, m.carry.igst]);
  }
  rows.push([], ["Invoice", "Date", "Client", "Client GSTIN", "Place of supply", "GSTR-1 section", "Taxable", "CGST", "SGST", "IGST", "Total"]);
  for (const { inv, section } of summary.invoices) {
    const t = inv.totals || {};
    rows.push([inv.no, inv.date, inv.client, inv.clientGstin, inv.pos, section, t.taxable, t.cgst, t.sgst, t.igst, t.total]);
  }
  return toCsv(rows);
};

// ---- Due dates ----------------------------------------------------------

const addMonths = (y, m, n) => {
  const t = y * 12 + (m - 1) + n;
  return [Math.floor(t / 12), (t % 12) + 1];
};
const day = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * GST due dates for West Bengal (QRMP: GSTR-3B on the 24th) and income tax dates
 * for a firm without audit. Returns the next `count` on or after `from`.
 */
export const deadlines = (firm, from, count = 6) => {
  const list = [];
  const [y0, m0] = from.slice(0, 7).split("-").map(Number);
  // Walk the months whose returns fall due from here on.
  for (let i = -3; i < 15; i++) {
    const [y, m] = addMonths(y0, m0, i); // tax period
    const [ny, nm] = addMonths(y, m, 1); // month after
    const label = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
    if (firm?.gstin) {
      if (firm.qrmp !== false) {
        const q = quarterOf(day(y, m, 1));
        const inQ = ((m + 8) % 12) % 3; // 0,1,2 = month within the quarter
        if (inQ < 2) list.push({ date: day(ny, nm, 25), what: `PMT-06 GST payment for ${label}` });
        else {
          const fy = fyOf(day(y, m, 1));
          list.push({ date: day(ny, nm, 13), what: `GSTR-1 for Q${q} ${fy}` });
          list.push({ date: day(ny, nm, 24), what: `GSTR-3B for Q${q} ${fy}` });
        }
      } else {
        list.push({ date: day(ny, nm, 11), what: `GSTR-1 for ${label}` });
        list.push({ date: day(ny, nm, 20), what: `GSTR-3B for ${label}` });
      }
    }
    // Advance tax instalments and the return for the firm (ITR-5, no audit).
    if (m === 6) list.push({ date: day(y, 6, 15), what: "Advance tax: 15% of the year's tax" });
    if (m === 9) list.push({ date: day(y, 9, 15), what: "Advance tax: 45% of the year's tax" });
    if (m === 12) list.push({ date: day(y, 12, 15), what: "Advance tax: 75% of the year's tax" });
    if (m === 3) list.push({ date: day(y, 3, 15), what: "Advance tax: 100% of the year's tax" });
    if (m === 7) list.push({ date: day(y, 7, 31), what: `Income tax return (ITR-5) for FY ${y - 1}-${String(y % 100).padStart(2, "0")}` });
  }
  return list
    .filter((d) => d.date >= from && (!firm?.gstFrom || !/GST|GSTR|PMT/.test(d.what) || d.date > firm.gstFrom))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, count);
};
