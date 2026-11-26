import { list, put, remove, get } from "../lib/store.js";
import { firm as getFirm, STATES, GST_RATES, PAY_MODES } from "../lib/firm.js";
import { invoiceTotals, statusOf, balanceOf, paidOf, nextInvoiceNo, lineAmount } from "../lib/tax.js";
import { inFy, fyOf, today, dateLabel } from "../lib/fy.js";
import { inr, r2 } from "../lib/money.js";
import { esc, uid, openSheet, confirmBox, field, select, val, toast, shareFile } from "../lib/ui.js";
import { invoicePdf, invoiceFileName } from "../lib/pdf.js";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const statusChip = (s) => `<span class="chip ${s === "Paid" ? "good" : s === "Part paid" ? "warn" : "bad"}">${s}</span>`;

export const renderInvoices = (el, ctx) => {
  const invs = list("invoice")
    .filter((i) => inFy(i.date, ctx.fy))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.no).localeCompare(String(a.no)));
  const total = r2(invs.reduce((s, i) => s + (i.totals?.total || 0), 0));
  const owed = r2(invs.reduce((s, i) => s + Math.max(0, balanceOf(i)), 0));
  el.innerHTML = `
    <div class="hero">
      <div class="label">Invoiced in ${esc(ctx.fy)}</div>
      <div class="big">${inr(total)}</div>
      <div class="sub">${invs.length} invoice${invs.length === 1 ? "" : "s"} · ${inr(owed)} still to collect</div>
    </div>
    ${invs.length ? invs.map((i) => `
      <button class="card" data-id="${esc(i.id)}">
        <div class="row"><b>${esc(i.client)}</b><b>${inr(i.totals?.total || 0)}</b></div>
        <div class="row muted"><span>${esc(i.no)} · ${dateLabel(i.date)}</span><span>${balanceOf(i) > 0.004 && paidOf(i) > 0 ? `${inr(balanceOf(i))} due` : ""}</span></div>
        <div class="chips">${statusChip(statusOf(i))}${i.totals?.type === "unregistered" ? "" : `<span class="chip">${i.totals?.type === "intra" ? "CGST+SGST" : "IGST"}</span>`}</div>
      </button>`).join("") : `<div class="empty"><b>No invoices in ${esc(ctx.fy)}</b>Tap + to create your first invoice.</div>`}`;
  el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => invoiceDetail(ctx, b.dataset.id)));
};

export const invoiceDetail = (ctx, id) => {
  const inv = get(id);
  if (!inv) return;
  const firm = getFirm();
  const t = inv.totals || {};
  openSheet({
    title: inv.no,
    body: `
      <div class="hero"><div class="label">${esc(inv.client)}</div><div class="big">${inr(t.total || 0)}</div>
        <div class="sub">${dateLabel(inv.date)} · ${statusOf(inv)}${balanceOf(inv) > 0.004 ? ` · ${inr(balanceOf(inv))} due` : ""}</div></div>
      <div class="card"><table class="t">
        ${(inv.items || []).map((it) => `<tr><td>${esc(it.desc)}<div class="muted small">${esc(it.qty)} × ${inr(it.rate)}${t.type !== "unregistered" ? ` · GST ${esc(it.gst)}%` : ""}</div></td><td>${inr(lineAmount(it))}</td></tr>`).join("")}
        <tr><td>Taxable value</td><td>${inr(t.taxable || 0)}</td></tr>
        ${t.type === "intra" ? `<tr><td>CGST</td><td>${inr(t.cgst)}</td></tr><tr><td>SGST</td><td>${inr(t.sgst)}</td></tr>` : ""}
        ${t.type === "inter" ? `<tr><td>IGST</td><td>${inr(t.igst)}</td></tr>` : ""}
        <tr><td><b>Total</b></td><td>${inr(t.total || 0)}</td></tr>
      </table>
      ${t.type === "unregistered" ? `<p class="muted small">Supplier not registered under GST on this date.</p>` : ""}</div>
      <div class="section"><h2>Payments</h2><span>${inr(paidOf(inv))} received</span></div>
      ${(inv.payments || []).length ? (inv.payments || []).map((p) => `<div class="card row"><span>${dateLabel(p.date)} · ${esc(p.mode)}</span><b>${inr(p.amount)}</b></div>`).join("") : `<div class="empty">No payments yet.</div>`}
      <div class="card muted small">Client: ${esc(inv.client)}${inv.clientGstin ? ` · GSTIN ${esc(inv.clientGstin)}` : ""}<br>Place of supply: ${esc(inv.pos || firm.state)}${inv.notes ? `<br>Notes: ${esc(inv.notes)}` : ""}</div>`,
    actions: [
      { label: "Delete", cls: "danger", onClick: async (close) => {
        if (await confirmBox(`Delete invoice ${inv.no}? This cannot be undone.`)) {
          remove(id);
          close();
          toast("Invoice deleted");
        }
      } },
      { label: "Edit", onClick: (close) => { close(); setTimeout(() => invoiceForm(ctx, inv), 50); } },
      { label: "Payment", onClick: (close) => { close(); setTimeout(() => paymentForm(inv), 50); } },
      { label: "PDF", cls: "primary", onClick: async () => {
        try {
          await shareFile(invoiceFileName(inv), invoicePdf(inv, firm), inv.no);
        } catch (err) {
          if (!/cancel/i.test(err.message || "")) toast(err.message || "Could not share");
        }
      } },
    ],
  });
};

const paymentForm = (inv) => {
  openSheet({
    title: "Add payment",
    full: false,
    body: `<div class="f2">${field("Date", "date", today(), 'type="date"')}${field("Amount (₹)", "amount", Math.max(0, balanceOf(inv)) || "", 'type="number" inputmode="decimal" step="0.01"')}</div>${select("Mode", "mode", PAY_MODES, "UPI")}`,
    onSave: (el) => {
      const amount = r2(val(el, "amount"));
      if (!(amount > 0)) throw new Error("Enter the amount received.");
      const fresh = get(inv.id) || inv;
      put("invoice", inv.id, { ...fresh, payments: [...(fresh.payments || []), { date: val(el, "date") || today(), amount, mode: val(el, "mode") }] });
      toast("Payment added");
    },
  });
};

const itemHtml = (it, firm) => `
  <div class="line-item">
    <button type="button" class="x" data-rm aria-label="Remove item">✕</button>
    <label class="f"><span>Description</span><input data-k="desc" value="${esc(it.desc || "")}" placeholder="e.g. POS plan, 12 months"></label>
    <div class="f3">
      <label class="f"><span>SAC</span><input data-k="sac" value="${esc(it.sac ?? firm.sac)}" inputmode="numeric"></label>
      <label class="f"><span>Qty</span><input data-k="qty" type="number" inputmode="decimal" step="any" value="${esc(it.qty ?? 1)}"></label>
      <label class="f"><span>GST %</span><select data-k="gst">${GST_RATES.map((r) => `<option${Number(it.gst ?? firm.gstRate) === r ? " selected" : ""}>${r}</option>`).join("")}</select></label>
    </div>
    <label class="f"><span>Rate (₹, before GST)</span><input data-k="rate" type="number" inputmode="decimal" step="0.01" value="${esc(it.rate ?? "")}"></label>
  </div>`;

const payHtml = (p) => `
  <div class="line-item">
    <button type="button" class="x" data-rm aria-label="Remove payment">✕</button>
    <div class="f3">
      <label class="f"><span>Date</span><input data-p="date" type="date" value="${esc(p.date || today())}"></label>
      <label class="f"><span>Amount ₹</span><input data-p="amount" type="number" inputmode="decimal" step="0.01" value="${esc(p.amount ?? "")}"></label>
      <label class="f"><span>Mode</span><select data-p="mode">${PAY_MODES.map((m) => `<option${m === p.mode ? " selected" : ""}>${m}</option>`).join("")}</select></label>
    </div>
  </div>`;

const readItems = (el) =>
  [...el.querySelectorAll("#items .line-item")].map((row) => {
    const g = (k) => row.querySelector(`[data-k="${k}"]`).value.trim();
    return { desc: g("desc"), sac: g("sac"), qty: Number(g("qty")) || 0, rate: r2(g("rate")), gst: Number(g("gst")) || 0 };
  });
const readPays = (el) =>
  [...el.querySelectorAll("#pays .line-item")]
    .map((row) => {
      const g = (k) => row.querySelector(`[data-p="${k}"]`).value.trim();
      return { date: g("date"), amount: r2(g("amount")), mode: g("mode") };
    })
    .filter((p) => p.amount > 0);

export const invoiceForm = (ctx, existing) => {
  const firm = getFirm();
  const inv = existing || { date: today(), pos: firm.state, items: [{}], payments: [] };
  const id = existing?.id || uid();
  const autoNo = () => nextInvoiceNo(firm.prefix || "KK", fyOf(inv.date), list("invoice").filter((i) => i.id !== id));
  let noTouched = !!existing;
  openSheet({
    title: existing ? `Edit ${existing.no}` : "New invoice",
    body: `
      <div class="f2">${field("Invoice no.", "no", inv.no || autoNo(), 'maxlength="16"')}${field("Date", "date", inv.date, 'type="date"')}</div>
      ${field("Client", "client", inv.client || "", 'autocomplete="organization"')}
      <label class="f"><span>Client address</span><textarea name="clientAddress" rows="2">${esc(inv.clientAddress || "")}</textarea></label>
      <div class="f2">${field("Client GSTIN (if any)", "clientGstin", inv.clientGstin || "", 'maxlength="15" style="text-transform:uppercase"')}${select("Place of supply", "pos", STATES, inv.pos || firm.state)}</div>
      <div class="section"><h2>Items</h2></div>
      <div id="items">${(inv.items?.length ? inv.items : [{}]).map((it) => itemHtml(it, firm)).join("")}</div>
      <button type="button" class="add" id="addItem">+ Add item</button>
      <div class="totals" id="tot"></div>
      <label class="f"><span>Notes</span><textarea name="notes" rows="2">${esc(inv.notes || "")}</textarea></label>
      <div class="section"><h2>Payments received</h2></div>
      <div id="pays">${(inv.payments || []).map(payHtml).join("")}</div>
      <button type="button" class="add" id="addPay">+ Add payment</button>`,
    onMount: (el) => {
      const showTotals = () => {
        const draft = { date: val(el, "date"), pos: val(el, "pos"), items: readItems(el) };
        const t = invoiceTotals(draft, firm);
        el.querySelector("#tot").innerHTML = `<table class="t">
          <tr><td>Taxable value</td><td>${inr(t.taxable)}</td></tr>
          ${t.type === "intra" ? `<tr><td>CGST</td><td>${inr(t.cgst)}</td></tr><tr><td>SGST</td><td>${inr(t.sgst)}</td></tr>` : ""}
          ${t.type === "inter" ? `<tr><td>IGST</td><td>${inr(t.igst)}</td></tr>` : ""}
          <tr><td><b>Total</b></td><td>${inr(t.total)}</td></tr></table>
          ${t.type === "unregistered" ? `<div class="muted small">No GST: ${firm.gstin ? "before the GST registration date" : "the firm is not registered under GST"}.</div>` : ""}`;
      };
      const wireRemove = () => el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { b.closest(".line-item").remove(); showTotals(); }));
      el.querySelector("#addItem").onclick = () => { el.querySelector("#items").insertAdjacentHTML("beforeend", itemHtml({}, firm)); wireRemove(); };
      el.querySelector("#addPay").onclick = () => { el.querySelector("#pays").insertAdjacentHTML("beforeend", payHtml({})); wireRemove(); };
      el.querySelector('[name="no"]').oninput = () => (noTouched = true);
      el.querySelector('[name="date"]').onchange = () => {
        inv.date = val(el, "date") || today();
        if (!noTouched) el.querySelector('[name="no"]').value = autoNo();
        showTotals();
      };
      el.addEventListener("input", showTotals);
      el.addEventListener("change", showTotals);
      wireRemove();
      showTotals();
    },
    onSave: (el) => {
      const data = {
        no: val(el, "no").toUpperCase(),
        date: val(el, "date"),
        client: val(el, "client"),
        clientAddress: val(el, "clientAddress"),
        clientGstin: val(el, "clientGstin").toUpperCase(),
        pos: val(el, "pos"),
        items: readItems(el).filter((it) => it.desc || it.rate),
        notes: val(el, "notes"),
        payments: readPays(el),
      };
      if (!data.no) throw new Error("Enter an invoice number.");
      if (!data.date) throw new Error("Choose the invoice date.");
      if (!data.client) throw new Error("Enter the client's name.");
      if (data.clientGstin && !GSTIN_RE.test(data.clientGstin)) throw new Error("That GSTIN does not look right (15 characters, e.g. 19ABCDE1234F1Z5).");
      if (!data.items.length || data.items.some((it) => !it.desc || !(lineAmount(it) > 0))) throw new Error("Each item needs a description, quantity and rate.");
      if (list("invoice").some((i) => i.id !== id && i.no === data.no)) throw new Error(`Invoice ${data.no} already exists.`);
      data.totals = invoiceTotals(data, firm);
      put("invoice", id, data);
      toast(existing ? "Invoice updated" : `Invoice ${data.no} saved`);
    },
  });
};
