import { list } from "../lib/store.js";
import { firm as getFirm } from "../lib/firm.js";
import { balanceOf, expenseTax } from "../lib/tax.js";
import { deadlines } from "../lib/gst.js";
import { inFy, fyMonths, monthLabel, today, dateLabel } from "../lib/fy.js";
import { inr, r2 } from "../lib/money.js";
import { esc } from "../lib/ui.js";

const TAX_RATE = 0.312; // firm: 30% + 4% cess
const THRESHOLD = 2000000; // GST registration limit for services

export const renderHome = (el, ctx) => {
  const firm = getFirm();
  const invs = list("invoice");
  const exps = list("expense");
  const fyInvs = invs.filter((i) => inFy(i.date, ctx.fy));
  const fyExps = exps.filter((e) => inFy(e.date, ctx.fy)).map((e) => ({ e, x: expenseTax(e, firm) }));
  const sales = r2(fyInvs.reduce((s, i) => s + (i.totals?.taxable || 0), 0));
  const costs = r2(fyExps.reduce((s, r) => s + r.x.cost, 0));
  const profit = r2(sales - costs);
  const owed = r2(invs.reduce((s, i) => s + Math.max(0, balanceOf(i)), 0));
  const tax = profit > 0 ? r2(profit * TAX_RATE) : 0;
  const pct = Math.round((sales / THRESHOLD) * 100);

  const months = fyMonths(ctx.fy).map((m) => ({
    m,
    s: fyInvs.filter((i) => i.date.startsWith(m)).reduce((t, i) => t + (i.totals?.taxable || 0), 0),
    c: fyExps.filter((r) => r.e.date.startsWith(m)).reduce((t, r) => t + r.x.cost, 0),
  }));
  const peak = Math.max(1, ...months.map((x) => Math.max(x.s, x.c)));

  const warnings = [];
  const notFirm = exps.filter((e) => e.inFirmName === false).length;
  if (notFirm) warnings.push(`${notFirm} bill${notFirm === 1 ? " is" : "s are"} not in the firm's name: GST on ${notFirm === 1 ? "it" : "them"} can never be claimed.`);
  if (!firm.gstin && sales > 1500000) warnings.push(`Sales this year are ${inr(sales)}, over ₹15 lakh, and the firm is not registered. Registration is required once turnover crosses ₹20 lakh.`);

  el.innerHTML = `
    ${warnings.map((w) => `<div class="notice warn">${esc(w)}</div>`).join("")}
    <div class="hero">
      <div class="label">${profit >= 0 ? "Profit" : "Loss"} · FY ${esc(ctx.fy)}</div>
      <div class="big${profit < 0 ? " neg" : ""}">${inr(profit)}</div>
      <div class="sub">Sales (without GST) minus costs</div>
    </div>
    <div class="grid">
      <div class="stat"><div class="label">Sales</div><div class="val">${inr(sales)}</div></div>
      <div class="stat"><div class="label">Costs</div><div class="val">${inr(costs)}</div></div>
      <div class="stat"><div class="label">Money owed to us</div><div class="val">${inr(owed)}</div></div>
      <div class="stat"><div class="label">Est. income tax (31.2%)</div><div class="val">${inr(tax)}</div></div>
    </div>
    <div class="card">
      <div class="row"><b>GST threshold</b><span class="muted">${pct}% of ₹20 lakh</span></div>
      <div class="bar" style="margin-top:8px"><div class="track"><div class="fill" style="width:${Math.min(100, pct)}%"></div></div></div>
      <div class="muted small" style="margin-top:6px">${firm.gstin ? `Registered: GSTIN ${esc(firm.gstin)}` : "Not registered under GST"}</div>
    </div>
    <div class="section"><h2>Sales vs costs</h2><span>by month</span></div>
    <div class="card">
      <div class="chart">${months.map((x) => `
        <div class="m"><div class="pair"><div class="s" style="height:${((x.s / peak) * 100).toFixed(1)}%" title="Sales ${inr(x.s)}"></div><div class="c" style="height:${((x.c / peak) * 100).toFixed(1)}%" title="Costs ${inr(x.c)}"></div></div><div class="lbl">${monthLabel(x.m).slice(0, 3)}</div></div>`).join("")}</div>
      <div class="legend"><span><i style="background:var(--accent)"></i>Sales</span><span><i style="background:var(--muted)"></i>Costs</span></div>
    </div>
    <div class="section"><h2>Coming up</h2></div>
    ${deadlines(firm, today(), 6).map((d) => `<div class="card row"><span>${esc(d.what)}</span><b>${dateLabel(d.date)}</b></div>`).join("")}`;
};
