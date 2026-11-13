/**
 * Accountant exports for the Partners dashboard: a GSTR-1 workbook and JSON,
 * and a Tally import, from one store's bills for a period, so the accountant
 * stops retyping figures.
 *
 * Every figure is per bill, from what the bill charged (bills.tax at
 * bills.taxPercent on food - discount + packaging: services/price), never
 * recomputed at a guessed rate. Pure: the route loads the orders.
 *
 * What a bill counts as
 *   - a cancelled bill is no sale (it is counted in the documents table only);
 *     a refund reduces the bill's figures in proportion (net of refunds);
 *   - B2B when the bill names a valid buyer GSTIN, else B2C;
 *   - a Swiggy / Zomato bill is a supply through an e-commerce operator, whose
 *     GST they pay (section 9(5)): reported apart, never in B2C;
 *   - service charge and delivery fee carry no GST on the bill (services/price):
 *     reported as charges without GST for the accountant to classify.
 * Restaurant service is supplied where the restaurant is: place of supply is
 * the store's state, CGST + SGST, as the bill printed.
 */

const { localDate, DEFAULT_TZ } = require("./tableBookings");
const { netAmount, orderTotal, wasPaid } = require("./refunds");
const { isValidGstin, RESTAURANT_SAC } = require("./gst");
const { parseBillNumber } = require("./billNumber");

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** GST state codes (first two digits of a GSTIN). */
const STATES = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const stateCodeOf = (gstin, stateName = "") => {
  const g = String(gstin || "").trim().toUpperCase();
  if (/^\d{2}/.test(g) && STATES[g.slice(0, 2)]) return g.slice(0, 2);
  const want = String(stateName || "").trim().toLowerCase();
  const hit = Object.entries(STATES).find(([, n]) => n.toLowerCase() === want);
  return hit ? hit[0] : "";
};
const posLabel = (code) => (code ? `${code}-${STATES[code] || ""}` : "");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-11-13 -> 13-Nov-2026 (the offline tool's Excel date) */
const dmy = (ymd) => `${ymd.slice(8, 10)}-${MONTHS[Number(ymd.slice(5, 7)) - 1]}-${ymd.slice(0, 4)}`;
/** 2026-11-13 -> 13-11-2026 (the JSON's date) */
const dmyNum = (ymd) => `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;

const CANCELLED = /cancel/i;

/**
 * One row per bill with its GST figures. `orders` are report views
 * (controllers/orderController reportFor) of one store.
 */
const billRows = (orders, { methodOf = () => "other" } = {}) =>
  orders.map((o) => {
    const b = o.bills || {};
    const day = localDate(new Date(o.orderDate || o.createdAt), DEFAULT_TZ);
    const total = orderTotal(o);
    const net = netAmount(o);
    const cancelled = CANCELLED.test(String(o.orderStatus || "")) && net === 0;
    // Refunds reduce every figure of the bill alike.
    const factor = total > 0 ? net / total : 0;
    const tax = round2(Number(b.tax) || 0);
    const rate = tax > 0 ? Number(b.taxPercent) || 0 : 0;
    const base = Math.max(0, round2((Number(b.subtotal) || 0) - (Number(b.discount) || 0) + (Number(b.packagingFee) || 0)));
    const taxable = rate > 0 && b.taxInclusive ? round2(base - tax) : base;
    const untaxed = round2((Number(b.serviceCharge) || 0) + (Number(b.deliveryFee) || 0));
    const gstin = String(o.customerDetails?.gstin || "").trim().toUpperCase();
    const source = String(o.source || "").toUpperCase();
    const s = (n) => round2(n * factor);
    const taxNet = s(tax);
    const cgst = round2(taxNet / 2);
    return {
      id: String(o._id),
      // The GST bill serial (services/billNumber), else the order number a
      // bill from before it was printed with.
      number: String(o.billNumber || o.orderNumber || o._id).slice(0, 16),
      serial: Boolean(parseBillNumber(o.billNumber)),
      day,
      channel: source === "MARKETPLACE" ? o.marketplace || "Swiggy/Zomato" : o.salesChannel === "KNOT_EATS" ? "Knot Eats" : source === "WEBSITE" ? "Website" : source === "QR" ? "Table QR" : "POS",
      // Invoiced by Swiggy / Zomato (section 9(5)), cancelled or not: never in the restaurant's documents.
      eco: source === "MARKETPLACE",
      kind: cancelled ? "cancelled" : source === "MARKETPLACE" ? "eco" : gstin && isValidGstin(gstin) ? "b2b" : "b2c",
      buyer: String(o.customerDetails?.company || o.customerDetails?.name || "").trim(),
      gstin: gstin && isValidGstin(gstin) ? gstin : "",
      badGstin: Boolean(gstin) && !isValidGstin(gstin),
      rate,
      taxable: s(taxable),
      cgst,
      sgst: round2(taxNet - cgst),
      tax: taxNet,
      serviceCharge: s(Number(b.serviceCharge) || 0),
      deliveryFee: s(Number(b.deliveryFee) || 0),
      untaxed: s(untaxed),
      value: round2(net),
      billTotal: total,
      refunded: round2(total - net),
      method: methodOf(o),
      split: Array.isArray(o.payments) && o.isSplit
        ? o.payments.filter((p) => Number(p.amount) > 0).map((p) => ({ method: String(p.method || "").toLowerCase(), amount: round2(p.amount) }))
        : null,
      paid: wasPaid(o),
      at: o.orderDate || o.createdAt,
    };
  });

/** Add rows' money fields into buckets keyed by `keyOf`. */
const sumBy = (rows, keyOf, init) => {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    const g = map.get(k) || { ...init(r), count: 0, taxable: 0, cgst: 0, sgst: 0, tax: 0, value: 0, untaxed: 0 };
    g.count += 1;
    for (const f of ["taxable", "cgst", "sgst", "tax", "value", "untaxed"]) g[f] = round2(g[f] + r[f]);
    map.set(k, g);
  }
  return [...map.values()];
};

/**
 * The GSTR-1 sections and the checks the accountant should see first.
 * @param {{ rows, store: { name, gstin, state }, from, to, voids?: string[] }} input  (YYYY-MM-DD)
 *        voids: bill numbers issued in the period whose order was never saved
 */
const gstr1 = ({ rows, store, from, to, voids = [] }) => {
  const pos = stateCodeOf(store.gstin, store.state);
  const live = rows.filter((r) => r.kind !== "cancelled" && r.value > 0);
  const b2b = live.filter((r) => r.kind === "b2b");
  const b2c = live.filter((r) => r.kind === "b2c");
  const eco = live.filter((r) => r.kind === "eco");
  const taxedB2c = b2c.filter((r) => r.rate > 0);
  const b2cs = sumBy(taxedB2c, (r) => r.rate, (r) => ({ rate: r.rate, pos }));
  const hsn = (list) => sumBy(list.filter((r) => r.rate > 0), (r) => r.rate, (r) => ({ rate: r.rate, hsn: RESTAURANT_SAC }));
  const nilB2c = b2c.filter((r) => r.rate === 0);
  // Table 13: every bill number issued, cancelled ones too. One line per
  // financial-year series (services/billNumber): first to last number, how
  // many, how many cancelled (void numbers too). Bills from before the series
  // (random order numbers) get a line of their own, first to last by time.
  const docs = [];
  const gaps = [];
  const used = new Set(rows.map((r) => r.number));
  const series = new Map();
  for (const r of rows.filter((x) => x.serial && !x.eco)) {
    const { fy, seq } = parseBillNumber(r.number);
    const g = series.get(fy) || { seqs: [], cancelled: 0 };
    g.seqs.push(seq);
    if (r.kind === "cancelled") g.cancelled += 1;
    series.set(fy, g);
  }
  for (const v of voids) {
    const parsed = parseBillNumber(v);
    if (!parsed || used.has(v)) continue;
    const g = series.get(parsed.fy) || { seqs: [], cancelled: 0 };
    g.seqs.push(parsed.seq);
    g.cancelled += 1;
    series.set(parsed.fy, g);
  }
  for (const [fy, g] of [...series.entries()].sort()) {
    const seqs = [...new Set(g.seqs)].sort((a, b) => a - b);
    const first = seqs[0];
    const last = seqs[seqs.length - 1];
    docs.push({ nature: "Invoices for outward supply", from: `${fy}/${String(first).padStart(6, "0")}`, to: `${fy}/${String(last).padStart(6, "0")}`, total: seqs.length, cancelled: g.cancelled });
    const missing = last - first + 1 - seqs.length;
    if (missing > 0) gaps.push({ fy, missing, first, last });
  }
  const legacy = rows.filter((r) => !r.serial && !r.eco).sort((a, b) => new Date(a.at) - new Date(b.at));
  if (legacy.length) {
    docs.push({ nature: "Invoices for outward supply (earlier numbering)", from: legacy[0].number, to: legacy[legacy.length - 1].number, total: legacy.length, cancelled: legacy.filter((r) => r.kind === "cancelled").length });
  }
  const totals = {
    bills: live.length,
    taxable: round2(live.reduce((s, r) => s + r.taxable, 0)),
    cgst: round2(live.reduce((s, r) => s + r.cgst, 0)),
    sgst: round2(live.reduce((s, r) => s + r.sgst, 0)),
    untaxed: round2(live.reduce((s, r) => s + r.untaxed, 0)),
    value: round2(live.reduce((s, r) => s + r.value, 0)),
    refunded: round2(rows.reduce((s, r) => s + (r.kind === "cancelled" ? 0 : r.refunded), 0)),
  };
  const warnings = [];
  if (!store.gstin) warnings.push("This store has no GST number in Store Properties: GSTR-1 does not apply to it. The Tally export still works.");
  if (store.gstin && !pos) warnings.push("The store's state could not be read from its GSTIN: set the state in Store Properties.");
  if (from.slice(0, 7) !== to.slice(0, 7)) warnings.push("The period spans more than one month. GSTR-1 is filed for one month (or quarter): export each month on its own for filing.");
  const bad = rows.filter((r) => r.badGstin).length;
  if (bad) warnings.push(`${bad} bill(s) carry a buyer GSTIN that is not valid; they are reported as B2C.`);
  if (eco.length) warnings.push(`${eco.length} Swiggy / Zomato bill(s): GST on these is paid by the platform (section 9(5)). They are listed apart and left out of B2C; report them in Table 14 with the platform's GSTIN.`);
  if (totals.untaxed > 0) warnings.push(`₹${totals.untaxed.toFixed(2)} of service charge and delivery fees carried no GST on the bills. They are listed apart for your accountant to classify.`);
  // Only news for a registered store: an unregistered one charges no GST on any bill.
  if (nilB2c.length && store.gstin) warnings.push(`${nilB2c.length} bill(s) carried no GST (no rate set when billed). Listed as Nil / non-GST.`);
  if (legacy.length && store.gstin) warnings.push(`${legacy.length} bill(s) are from before consecutive bill numbers: they keep the order numbers they were printed with, on a line of their own in the documents table.`);
  for (const gap of gaps) warnings.push(`${gap.missing} bill number(s) between ${gap.fy}/${String(gap.first).padStart(6, "0")} and ${gap.fy}/${String(gap.last).padStart(6, "0")} are not in this period: usually bills dated just outside it (an offline sale synced late). Check the neighbouring month.`);
  return {
    store: { ...store, pos, posLabel: posLabel(pos) },
    period: { from, to, fp: `${to.slice(5, 7)}${to.slice(0, 4)}` },
    totals,
    b2b,
    b2cs,
    hsnB2b: hsn(b2b),
    hsnB2c: hsn(b2c),
    nil: { count: nilB2c.length, value: round2(nilB2c.reduce((s, r) => s + r.taxable, 0)) },
    eco: sumBy(eco, (r) => `${r.channel}|${r.rate}`, (r) => ({ channel: r.channel, rate: r.rate })),
    docs,
    warnings,
  };
};

/* --------------------------------------------------------------- Excel -- */

/** The workbook: the offline tool's sheet names and headings, plus a summary and every bill. */
const gstr1Sheets = (g, rows) => {
  const P = g.store.posLabel;
  return [
    {
      name: "Summary",
      widths: [42, 28],
      rows: [
        ["GSTR-1 working", ""],
        ["Store", g.store.name],
        ["GSTIN", g.store.gstin || "Not registered"],
        ["Place of supply", P],
        ["Period", `${dmy(g.period.from)} to ${dmy(g.period.to)}`],
        ["Return period (fp)", g.period.fp],
        ["Bills (net of cancelled)", g.totals.bills],
        ["Taxable value", g.totals.taxable],
        ["Central tax (CGST)", g.totals.cgst],
        ["State/UT tax (SGST)", g.totals.sgst],
        ["Charges without GST (service charge, delivery)", g.totals.untaxed],
        ["Total bill value (net of refunds)", g.totals.value],
        ["Refunded", g.totals.refunded],
        ["Nil / non-GST bills", g.nil.count],
        ["Nil / non-GST value", g.nil.value],
        ["", ""],
        ["Notes", ""],
        ...g.warnings.map((w) => ["", w]),
      ],
    },
    {
      name: "b2b",
      widths: [18, 28, 16, 14, 14, 22, 14, 22, 14, 18, 8, 14, 12],
      rows: [
        ["GSTIN/UIN of Recipient", "Receiver Name", "Invoice Number", "Invoice date", "Invoice Value", "Place Of Supply", "Reverse Charge", "Applicable % of Tax Rate", "Invoice Type", "E-Commerce GSTIN", "Rate", "Taxable Value", "Cess Amount"],
        ...g.b2b.map((r) => [r.gstin, r.buyer, r.number, dmy(r.day), r.value, P, "N", "", "Regular B2B", "", r.rate, r.taxable, 0]),
      ],
    },
    {
      name: "b2cs",
      widths: [8, 22, 22, 8, 14, 12, 18],
      rows: [
        ["Type", "Place Of Supply", "Applicable % of Tax Rate", "Rate", "Taxable Value", "Cess Amount", "E-Commerce GSTIN"],
        ...g.b2cs.map((r) => ["OE", P, "", r.rate, r.taxable, 0, ""]),
      ],
    },
    ...[
      ["hsn(b2b)", g.hsnB2b],
      ["hsn(b2c)", g.hsnB2c],
    ].map(([name, list]) => ({
      name,
      widths: [10, 26, 10, 14, 14, 8, 14, 18, 18, 18, 12],
      rows: [
        ["HSN", "Description", "UQC", "Total Quantity", "Total Value", "Rate", "Taxable Value", "Integrated Tax Amount", "Central Tax Amount", "State/UT Tax Amount", "Cess Amount"],
        ...list.map((r) => [r.hsn, "Restaurant service", "NA", 0, round2(r.taxable + r.tax), r.rate, r.taxable, 0, r.cgst, r.sgst, 0]),
      ],
    })),
    {
      name: "docs",
      widths: [34, 16, 16, 14, 12],
      rows: [
        ["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled"],
        ...g.docs.map((d) => [d.nature, d.from, d.to, d.total, d.cancelled]),
      ],
    },
    {
      name: "eco (Swiggy, Zomato)",
      widths: [18, 8, 10, 14, 14, 14],
      rows: [
        ["Platform", "Rate", "Bills", "Taxable Value", "Central Tax", "State/UT Tax"],
        ...g.eco.map((r) => [r.channel, r.rate, r.count, r.taxable, r.cgst, r.sgst]),
      ],
    },
    {
      name: "Bills",
      widths: [12, 12, 12, 10, 26, 18, 7, 13, 11, 11, 13, 13, 12, 12, 10],
      rows: [
        ["Date", "Bill No.", "Channel", "Type", "Buyer", "Buyer GSTIN", "Rate", "Taxable Value", "CGST", "SGST", "Service charge", "Delivery fee", "Bill value", "Refunded", "Payment"],
        ...rows
          .slice()
          .sort((a, b) => new Date(a.at) - new Date(b.at))
          .map((r) => [dmy(r.day), r.number, r.channel, r.kind === "eco" ? "Platform" : r.kind.toUpperCase(), r.buyer, r.gstin, r.rate, r.taxable, r.cgst, r.sgst, r.serviceCharge, r.deliveryFee, r.value, r.refunded, r.kind === "cancelled" ? "Cancelled" : r.paid ? r.method : "unpaid"]),
      ],
    },
  ];
};

/* ---------------------------------------------------------------- JSON -- */

/** GSTR-1 JSON as the GST offline tool and portal read it. */
const gstr1Json = (g) => {
  const pos = g.store.pos;
  const byBuyer = new Map();
  for (const r of g.b2b.filter((x) => x.rate > 0)) {
    const list = byBuyer.get(r.gstin) || [];
    list.push({
      inum: r.number,
      idt: dmyNum(r.day),
      val: r.value,
      pos,
      rchrg: "N",
      inv_typ: "R",
      itms: [{ num: Math.round(r.rate * 100) + 1, itm_det: { rt: r.rate, txval: r.taxable, camt: r.cgst, samt: r.sgst, csamt: 0 } }],
    });
    byBuyer.set(r.gstin, list);
  }
  const hsnRows = (list) =>
    list.map((r, i) => ({ num: i + 1, hsn_sc: r.hsn, desc: "Restaurant service", uqc: "NA", qty: 0, rt: r.rate, txval: r.taxable, iamt: 0, camt: r.cgst, samt: r.sgst, csamt: 0 }));
  return {
    gstin: g.store.gstin,
    fp: g.period.fp,
    b2b: [...byBuyer.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cs: g.b2cs.map((r) => ({ sply_ty: "INTRA", rt: r.rate, typ: "OE", pos, txval: r.taxable, camt: r.cgst, samt: r.sgst, csamt: 0 })),
    hsn: { hsn_b2b: hsnRows(g.hsnB2b), hsn_b2c: hsnRows(g.hsnB2c) },
    ...(g.nil.count ? { nil: { inv: [{ sply_ty: "INTRAB2C", expt_amt: 0, nil_amt: 0, ngsup_amt: g.nil.value }] } } : {}),
    ...(g.docs.length
      ? { doc_issue: { doc_det: [{ doc_num: 1, docs: g.docs.map((d, i) => ({ num: i + 1, from: d.from, to: d.to, totnum: d.total, cancel: d.cancelled, net_issue: d.total - d.cancelled })) }] } }
      : {}),
  };
};

/* --------------------------------------------------------------- Tally -- */

const DEFAULT_LEDGERS = {
  sales: "Sales @ {rate}% GST",
  salesNoGst: "Sales (No GST)",
  cgst: "Output CGST @ {half}%",
  sgst: "Output SGST @ {half}%",
  serviceCharge: "Service Charges",
  deliveryFee: "Delivery Charges",
  cash: "Cash",
  upi: "UPI Collections",
  card: "Card Collections",
  gateway: "Online Payments",
  other: "Sales Pending Collection",
  roundOff: "Round Off",
};

const xmlEsc = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fill = (tpl, rate) => String(tpl).replace("{rate}", String(rate)).replace("{half}", String(round2(rate / 2)));
const amt = (n) => round2(n).toFixed(2);
const tallyDate = (ymd) => ymd.replace(/-/g, "");

const PAY = { cash: "cash", upi: "upi", card: "card", gateway: "gateway", online: "gateway", wallet: "gateway" };

/**
 * Tally XML: the ledgers it uses (created on import; existing ones are left
 * as they are), then Sales vouchers. `mode` "bill" = one voucher per bill;
 * "day" = one per day and GST rate for B2C bills (B2B bills always their own,
 * with the buyer's ledger and GSTIN). Credits: sales (taxable), CGST, SGST,
 * the charges without GST; debit: how it was paid. Paise left by rounding go
 * to Round Off, so every voucher balances.
 */
const tallyXml = ({ rows, store, mode = "bill", ledgers = {} }) => {
  const L = { ...DEFAULT_LEDGERS, ...Object.fromEntries(Object.entries(ledgers || {}).filter(([k, v]) => DEFAULT_LEDGERS[k] && String(v || "").trim()).map(([k, v]) => [k, String(v).trim().slice(0, 80)])) };
  const live = rows.filter((r) => r.kind !== "cancelled" && r.value > 0);
  const masters = new Map(); // name -> { parent, extra }
  const ledger = (name, parent, extra = "") => {
    if (!masters.has(name)) masters.set(name, { parent, extra });
    return name;
  };
  const payLedger = (method) => {
    const k = PAY[method] || (method === "other" ? "other" : "gateway");
    return ledger(L[k], k === "cash" ? "Cash-in-Hand" : k === "other" ? "Sundry Debtors" : "Bank Accounts");
  };
  const taxLedger = (key, rate, head) =>
    ledger(fill(L[key], rate), "Duties & Taxes", `<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>${head}</GSTDUTYHEAD><RATEOFTAXCALCULATION>${round2(rate / 2)}</RATEOFTAXCALCULATION>`);

  /** One voucher from summed figures. debits: [{ ledger, amount }] */
  const voucher = ({ day, number, narration, party, partyGstin, rate, taxable, cgst, sgst, serviceCharge, deliveryFee, debits }) => {
    const credits = [];
    if (taxable > 0) credits.push({ ledger: rate > 0 ? ledger(fill(L.sales, rate), "Sales Accounts") : ledger(L.salesNoGst, "Sales Accounts"), amount: taxable });
    if (cgst > 0) credits.push({ ledger: taxLedger("cgst", rate, "Central Tax"), amount: cgst });
    if (sgst > 0) credits.push({ ledger: taxLedger("sgst", rate, "State Tax"), amount: sgst });
    if (serviceCharge > 0) credits.push({ ledger: ledger(L.serviceCharge, "Indirect Incomes"), amount: serviceCharge });
    if (deliveryFee > 0) credits.push({ ledger: ledger(L.deliveryFee, "Indirect Incomes"), amount: deliveryFee });
    const cr = round2(credits.reduce((s, c) => s + c.amount, 0));
    const dr = round2(debits.reduce((s, d) => s + d.amount, 0));
    const diff = round2(dr - cr);
    if (diff !== 0) credits.push({ ledger: ledger(L.roundOff, "Indirect Expenses"), amount: diff });
    const entry = (name, amount, debit) =>
      `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${debit ? "-" : ""}${amt(Math.abs(amount))}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    // A negative round-off is a debit.
    const crXml = credits.map((c) => (c.amount < 0 ? entry(c.ledger, -c.amount, true) : entry(c.ledger, c.amount, false))).join("");
    const drXml = debits.map((d) => entry(d.ledger, d.amount, true)).join("");
    return (
      `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
      `<DATE>${tallyDate(day)}</DATE><EFFECTIVEDATE>${tallyDate(day)}</EFFECTIVEDATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>` +
      `<VOUCHERNUMBER>${xmlEsc(number)}</VOUCHERNUMBER><REFERENCE>${xmlEsc(number)}</REFERENCE>` +
      `<PARTYLEDGERNAME>${xmlEsc(party)}</PARTYLEDGERNAME>${partyGstin ? `<PARTYGSTIN>${xmlEsc(partyGstin)}</PARTYGSTIN>` : ""}` +
      `<PLACEOFSUPPLY>${xmlEsc(STATES[stateCodeOf(store.gstin, store.state)] || store.state || "")}</PLACEOFSUPPLY>` +
      `<NARRATION>${xmlEsc(narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
      `${drXml}${crXml}</VOUCHER></TALLYMESSAGE>`
    );
  };

  const debitsOf = (r) => {
    if (r.split?.length) {
      const sum = round2(r.split.reduce((s, p) => s + p.amount, 0));
      const k = sum > 0 ? r.value / sum : 0;
      return r.split.map((p) => ({ ledger: payLedger(p.method), amount: round2(p.amount * k) }));
    }
    return [{ ledger: payLedger(r.paid ? r.method : "other"), amount: r.value }];
  };

  const vouchers = [];
  const receipts = [];
  const perBill = mode !== "day";
  for (const r of live) {
    if (!perBill && r.kind !== "b2b") continue;
    if (r.kind === "b2b") {
      // A business buyer: sold to their ledger (with GSTIN), then the payment received from them.
      const party = ledger(r.buyer || r.gstin, "Sundry Debtors", `<PARTYGSTIN>${xmlEsc(r.gstin)}</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>`);
      vouchers.push(voucher({ ...r, number: r.number, narration: `KnotKitchen bill ${r.number} (${r.channel}), ${r.buyer} ${r.gstin}`, party, partyGstin: r.gstin, debits: [{ ledger: party, amount: r.value }] }));
      if (r.paid) {
        const from = debitsOf(r);
        receipts.push(
          `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">` +
            `<DATE>${tallyDate(r.day)}</DATE><VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEsc(`R-${r.number}`)}</VOUCHERNUMBER>` +
            `<PARTYLEDGERNAME>${xmlEsc(party)}</PARTYLEDGERNAME><NARRATION>${xmlEsc(`Payment for bill ${r.number}`)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>` +
            from.map((d) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(d.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${amt(d.amount)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join("") +
            `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amt(from.reduce((s, d) => s + d.amount, 0))}</AMOUNT></ALLLEDGERENTRIES.LIST>` +
            `</VOUCHER></TALLYMESSAGE>`
        );
      }
      continue;
    }
    const debits = debitsOf(r);
    vouchers.push(voucher({ ...r, narration: `KnotKitchen bill ${r.number} (${r.channel})`, party: debits[0].ledger, debits }));
  }
  if (!perBill) {
    // One voucher per day and rate for the B2C and platform bills, debited by payment method.
    const groups = new Map();
    for (const r of live.filter((x) => x.kind !== "b2b")) {
      const key = `${r.day}|${r.rate}`;
      const g = groups.get(key) || { day: r.day, rate: r.rate, taxable: 0, cgst: 0, sgst: 0, serviceCharge: 0, deliveryFee: 0, count: 0, debits: new Map() };
      for (const f of ["taxable", "cgst", "sgst", "serviceCharge", "deliveryFee"]) g[f] = round2(g[f] + r[f]);
      g.count += 1;
      for (const d of debitsOf(r)) g.debits.set(d.ledger, round2((g.debits.get(d.ledger) || 0) + d.amount));
      groups.set(key, g);
    }
    for (const g of [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.rate - b.rate)) {
      const debits = [...g.debits.entries()].map(([l, a]) => ({ ledger: l, amount: a }));
      vouchers.push(voucher({ ...g, number: `KK-${g.day.replace(/-/g, "")}-${g.rate}`, narration: `KnotKitchen sales ${dmy(g.day)}: ${g.count} bill(s) at ${g.rate}% GST`, party: debits[0]?.ledger || payLedger("cash"), debits }));
    }
  }

  const masterXml = [...masters.entries()]
    .map(([name, m]) => `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${xmlEsc(name)}" RESERVEDNAME=""><NAME.LIST><NAME>${xmlEsc(name)}</NAME></NAME.LIST><PARENT>${xmlEsc(m.parent)}</PARENT>${m.extra}</LEDGER></TALLYMESSAGE>`)
    .join("");
  return (
    // One import: the ledgers first, so every voucher after them finds its ledgers.
    `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY>` +
    `<IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${masterXml}${vouchers.join("")}${receipts.join("")}</REQUESTDATA></IMPORTDATA>` +
    `</BODY></ENVELOPE>\n`
  );
};

module.exports = { billRows, gstr1, gstr1Sheets, gstr1Json, tallyXml, DEFAULT_LEDGERS, stateCodeOf, STATES };
