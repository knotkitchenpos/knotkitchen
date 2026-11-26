import { list } from "../lib/store.js";
import { firm as getFirm } from "../lib/firm.js";
import { quarterSummary, quarterCsv, deadlines } from "../lib/gst.js";
import { fyOf, quarterOf, today, monthLabel, dateLabel } from "../lib/fy.js";
import { inr, r2 } from "../lib/money.js";
import { esc, shareFile, toast } from "../lib/ui.js";

let chosenQ = null;

const heads = (o) => `CGST ${inr(o.cgst)} · SGST ${inr(o.sgst)} · IGST ${inr(o.igst)}`;

export const renderGst = (el, ctx) => {
  const firm = getFirm();
  const q = chosenQ || (fyOf(today()) === ctx.fy ? quarterOf(today()) : 1);
  const s = quarterSummary(ctx.fy, q, list("invoice"), list("expense"), firm);
  const cash = r2(s.months.reduce((t, m) => t + m.cash.cgst + m.cash.sgst + m.cash.igst, 0));
  const a = s.gstr3b["3.1(a)"];
  const itc = s.gstr3b["4(A)(5)"];
  const due = deadlines(firm, today(), 6).filter((d) => /GST|PMT/.test(d.what));
  el.innerHTML = `
    <div class="seg">${[1, 2, 3, 4].map((n) => `<button data-q="${n}" class="${n === q ? "on" : ""}">Q${n}</button>`).join("")}</div>
    ${firm.gstin ? "" : `<div class="notice warn">Not registered under GST: no GST is charged and none is due. Add the GSTIN and registration date in Settings once registered.</div>`}
    <div class="hero">
      <div class="label">GST to pay in cash · Q${q} ${esc(ctx.fy)}</div>
      <div class="big">${inr(cash)}</div>
      <div class="sub">After input tax credit. Credit left: ${inr(s.months[2].carry.cgst + s.months[2].carry.sgst + s.months[2].carry.igst)}</div>
    </div>
    ${s.months.map((m) => `
      <div class="card">
        <div class="row"><b>${monthLabel(m.month)}</b><b>${inr(m.cash.cgst + m.cash.sgst + m.cash.igst)} cash</b></div>
        <table class="t small">
          <tr><td>B2B sales (taxable)</td><td>${inr(m.b2b)}</td></tr>
          <tr><td>B2C sales (taxable)</td><td>${inr(m.b2c)}</td></tr>
          <tr><td>Output tax</td><td>${heads(m.out)}</td></tr>
          <tr><td>ITC this month</td><td>${heads(m.itc)}</td></tr>
          <tr><td>Credit brought in</td><td>${heads(m.opening)}</td></tr>
          <tr><td>Cash to pay</td><td>${heads(m.cash)}</td></tr>
          <tr><td>Credit carried forward</td><td>${heads(m.carry)}</td></tr>
        </table>
      </div>`).join("")}
    <div class="section"><h2>GSTR-3B (quarter)</h2></div>
    <div class="card"><table class="t small">
      <tr><td>3.1(a) Outward taxable supplies: value</td><td>${inr(a.taxable)}</td></tr>
      <tr><td>3.1(a) Tax</td><td>${heads(a)}</td></tr>
      <tr><td>4(A)(5) All other ITC</td><td>${heads(itc)}</td></tr>
    </table></div>
    <div class="section"><h2>GSTR-1 invoices</h2><button id="csv">Export CSV</button></div>
    ${s.invoices.length ? s.invoices.map(({ inv, section }) => `
      <div class="card"><div class="row"><b>${esc(inv.no)}</b><b>${inr(inv.totals?.total || 0)}</b></div>
      <div class="row muted"><span>${esc(inv.client)} · ${dateLabel(inv.date)}</span><span class="chip">${esc(section)}</span></div></div>`).join("")
      : `<div class="empty"><b>No GST invoices this quarter</b>${firm.gstin ? "Invoices dated after registration show here." : ""}</div>`}
    <div class="section"><h2>Due dates</h2><span>${firm.qrmp !== false ? "QRMP" : "Monthly"}</span></div>
    ${due.length ? due.map((d) => `<div class="card row"><span>${esc(d.what)}</span><b>${dateLabel(d.date)}</b></div>`).join("") : `<div class="empty">No GST returns due while unregistered.</div>`}
    <div class="notice info">Verify ITC against GSTR-2B; confirm due dates on gst.gov.in.</div>`;
  el.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { chosenQ = Number(b.dataset.q); ctx.rerender(); }));
  el.querySelector("#csv").onclick = async () => {
    try {
      await shareFile(`GST-${ctx.fy}-Q${q}.csv`, new Blob([quarterCsv(ctx.fy, q, s)], { type: "text/csv" }), `GST Q${q} ${ctx.fy}`);
    } catch (err) {
      if (!/cancel/i.test(err.message || "")) toast(err.message || "Could not export");
    }
  };
};
