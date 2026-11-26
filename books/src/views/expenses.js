import { Capacitor } from "@capacitor/core";
import { list, put, remove, get } from "../lib/store.js";
import { firm as getFirm, CATEGORIES, GST_RATES, PAY_MODES } from "../lib/firm.js";
import { expenseTax } from "../lib/tax.js";
import { inFy, today, dateLabel } from "../lib/fy.js";
import { inr, r2 } from "../lib/money.js";
import { esc, uid, openSheet, confirmBox, field, select, check, val, checked, toast, shareFile } from "../lib/ui.js";
import { takePhoto, fromFileInput, storeReceipt, receiptBlob } from "../lib/files.js";
import { api } from "../lib/api.js";

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const TAX_TYPES = [["cgst_sgst", "CGST + SGST"], ["igst", "IGST"], ["none", "No GST"]];

const flags = (x) =>
  [
    x.claimable ? `<span class="chip good">ITC ${inr(x.gst)}</span>` : "",
    x.maybeAtRegistration ? `<span class="chip warn">May be claimable at registration</span>` : "",
    x.notInFirmName ? `<span class="chip bad">Bill not in firm's name</span>` : "",
  ].join("");

export const renderExpenses = (el, ctx) => {
  const firm = getFirm();
  const exps = list("expense")
    .filter((e) => inFy(e.date, ctx.fy))
    .sort((a, b) => b.date.localeCompare(a.date));
  const rows = exps.map((e) => ({ e, x: expenseTax(e, firm) }));
  const cost = r2(rows.reduce((s, r) => s + r.x.cost, 0));
  const itc = r2(rows.reduce((s, r) => s + (r.x.claimable ? r.x.gst : 0), 0));
  const byCat = {};
  for (const r of rows) byCat[r.e.category] = r2((byCat[r.e.category] || 0) + r.x.cost);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] || 1;
  el.innerHTML = `
    <div class="hero">
      <div class="label">Costs in ${esc(ctx.fy)}</div>
      <div class="big">${inr(cost)}</div>
      <div class="sub">${exps.length} bill${exps.length === 1 ? "" : "s"} · ITC claimable ${inr(itc)}</div>
    </div>
    ${cats.length ? `<div class="card"><div class="bars">${cats.map(([c, v]) => `
      <div class="bar"><div class="top-line"><span>${esc(c)}</span><span>${inr(v)}</span></div><div class="track"><div class="fill" style="width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></div></div></div>`).join("")}</div></div>` : ""}
    <div class="section"><h2>Bills</h2></div>
    ${rows.length ? rows.map(({ e, x }) => `
      <button class="card" data-id="${esc(e.id)}">
        <div class="row"><b>${esc(e.vendor || e.description || "Expense")}</b><b>${inr(x.amount + x.gst)}</b></div>
        <div class="row muted"><span>${dateLabel(e.date)} · ${esc(e.category)}</span><span>${e.receipt ? "📎" : ""}</span></div>
        ${flags(x) ? `<div class="chips">${flags(x)}</div>` : ""}
      </button>`).join("") : `<div class="empty"><b>No expenses in ${esc(ctx.fy)}</b>Tap + to add a bill.</div>`}`;
  el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => expenseDetail(ctx, b.dataset.id)));
};

const expenseDetail = (ctx, id) => {
  const e = get(id);
  if (!e) return;
  const x = expenseTax(e, getFirm());
  openSheet({
    title: e.vendor || "Expense",
    body: `
      <div class="hero"><div class="label">${esc(e.category)}</div><div class="big">${inr(x.amount + x.gst)}</div><div class="sub">${dateLabel(e.date)} · paid via ${esc(e.paidVia || "-")}</div></div>
      <div class="card"><table class="t">
        <tr><td>Amount before GST</td><td>${inr(x.amount)}</td></tr>
        ${x.cgst ? `<tr><td>CGST</td><td>${inr(x.cgst)}</td></tr><tr><td>SGST</td><td>${inr(x.sgst)}</td></tr>` : ""}
        ${x.igst ? `<tr><td>IGST</td><td>${inr(x.igst)}</td></tr>` : ""}
        <tr><td>Cost in profit &amp; loss</td><td>${inr(x.cost)}</td></tr>
      </table>
      ${flags(x) ? `<div class="chips">${flags(x)}</div>` : ""}
      ${!x.claimable && x.gst > 0 ? `<p class="muted small">GST is a cost here: ITC needs registration on the bill date, the vendor's GSTIN, the bill in the firm's name, business use, and not food &amp; entertainment.</p>` : ""}</div>
      <div class="card muted small">${e.description ? `${esc(e.description)}<br>` : ""}${e.vendorGstin ? `Vendor GSTIN ${esc(e.vendorGstin)}` : "No vendor GSTIN"}</div>
      ${e.receipt ? `<div class="card"><b>Bill</b><div id="rc" class="muted small">Loading…</div></div>` : ""}`,
    onMount: async (el) => {
      if (!e.receipt) return;
      const box = el.querySelector("#rc");
      try {
        const blob = await receiptBlob(e.receipt);
        if (!blob) {
          box.textContent = e.receipt.pending ? "The bill is still on the phone it was added on; it uploads when that phone is online." : "File not found.";
          return;
        }
        if ((blob.type || e.receipt.type || "").startsWith("image/")) {
          box.innerHTML = `<img class="receipt-img" alt="Bill">`;
          box.querySelector("img").src = URL.createObjectURL(blob);
        } else {
          box.innerHTML = `<button class="btn" type="button">Open PDF</button>`;
          box.querySelector("button").onclick = () => shareFile(e.receipt.name || "bill.pdf", blob, "Bill");
        }
      } catch (err) {
        box.textContent = err.status ? err.message : "Connect to the internet to see the bill.";
      }
    },
    actions: [
      { label: "Delete", cls: "danger", onClick: async (close) => {
        if (await confirmBox("Delete this expense? This cannot be undone.")) {
          remove(id);
          close();
          toast("Expense deleted");
        }
      } },
      { label: "Edit", cls: "primary", onClick: (close) => { close(); setTimeout(() => expenseForm(ctx, e), 50); } },
    ],
  });
};

export const expenseForm = (ctx, existing) => {
  const firm = getFirm();
  const e = existing || { date: today(), category: CATEGORIES[0], gstRate: firm.gstRate, taxType: "cgst_sgst", paidVia: "UPI", inFirmName: true, businessUse: true };
  const id = existing?.id || uid();
  let receipt = e.receipt || null;
  const native = Capacitor.isNativePlatform();
  openSheet({
    title: existing ? "Edit expense" : "New expense",
    body: `
      <div class="card scan">
        <b>Scan bill</b>
        <div class="muted small">Photo or PDF of the bill: the form fills itself. Check it, then save.</div>
        <div class="f2" style="margin-top:8px">
          ${native ? `<button type="button" class="btn primary" id="scanCam">Take photo</button>` : ""}
          <label class="btn ${native ? "" : "primary"}" style="text-align:center">Choose bill<input type="file" id="scanFile" accept="image/*,application/pdf" hidden></label>
        </div>
        <div id="scanNote" class="small" style="margin-top:8px"></div>
      </div>
      <div class="f2">${field("Date", "date", e.date, 'type="date"')}${select("Category", "category", CATEGORIES, e.category)}</div>
      ${field("Vendor", "vendor", e.vendor || "")}
      ${field("Vendor GSTIN (from the bill)", "vendorGstin", e.vendorGstin || "", 'maxlength="15" style="text-transform:uppercase"')}
      ${field("Description", "description", e.description || "")}
      <div class="f2">${field("Amount before GST (₹)", "amount", e.amount ?? "", 'type="number" inputmode="decimal" step="0.01"')}${select("GST rate %", "gstRate", GST_RATES, e.gstRate)}</div>
      <div class="f2">${select("Tax on the bill", "taxType", TAX_TYPES, e.taxType)}${select("Paid via", "paidVia", PAY_MODES, e.paidVia)}</div>
      ${check("Bill is in the firm's name", "inFirmName", e.inFirmName !== false)}
      ${check("For business use", "businessUse", e.businessUse !== false)}
      <div class="totals" id="tot"></div>
      <div class="section"><h2>Bill photo / PDF</h2></div>
      <div id="rcpt" class="muted small"></div>
      <div class="f2" style="margin-top:8px">
        ${native ? `<button type="button" class="btn" id="cam">Take photo</button>` : ""}
        <label class="btn" style="text-align:center">Choose file<input type="file" id="file" accept="image/*,application/pdf" hidden></label>
      </div>`,
    onMount: (el) => {
      const showRcpt = () => {
        el.querySelector("#rcpt").innerHTML = receipt
          ? `Attached: ${esc(receipt.name || "bill")}${receipt.pending ? " (uploads when online)" : ""} <button type="button" class="btn" id="rmr" style="padding:4px 10px">Remove</button>`
          : "No bill attached.";
        el.querySelector("#rmr")?.addEventListener("click", () => { receipt = null; showRcpt(); });
      };
      const attach = async (picked) => {
        if (!picked) return;
        el.querySelector("#rcpt").textContent = "Saving the bill…";
        try {
          receipt = await storeReceipt(picked);
        } catch (err) {
          toast(err.message || "Could not attach");
        }
        showRcpt();
      };
      // Scan: attach the bill, then let the server read it and fill the form.
      const note = (html) => (el.querySelector("#scanNote").innerHTML = html);
      const setField = (name, v) => {
        const input = el.querySelector(`[name="${name}"]`);
        if (input.type === "checkbox") input.checked = !!v;
        else input.value = v;
      };
      const scan = async (picked) => {
        if (!picked) return;
        note("Reading the bill…");
        await attach(picked);
        if (!receipt?.id) {
          note(receipt?.pending ? "Scanning needs internet. The bill is attached; fill the form by hand." : "");
          return;
        }
        try {
          const b = await api("/scan", { method: "POST", body: { fileId: receipt.id } });
          if (!b.isBill) {
            note(`<span class="chip warn">This does not look like a bill</span> ${esc(b.note)}`);
            return;
          }
          if (b.date) setField("date", b.date);
          setField("vendor", b.vendor);
          setField("vendorGstin", b.vendorGstin);
          setField("description", [b.description, b.invoiceNo && `Inv ${b.invoiceNo}`].filter(Boolean).join(" · "));
          setField("category", b.category);
          setField("amount", b.amountBeforeGst || "");
          setField("gstRate", b.gstRate);
          setField("taxType", b.taxType);
          // ITC needs the bill in the firm's name: only tick it when the bill says so.
          const squash = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          setField("inFirmName", !!b.billedTo && squash(b.billedTo).includes(squash(firm.name)));
          showTotals();
          const x = expenseTax(read(el), firm);
          const off = b.totalAmount && Math.abs(x.amount + x.gst - b.totalAmount) > 1;
          note([
            `<span class="chip good">Filled from the bill</span> Check every field before saving.`,
            b.billedTo ? `Billed to: ${esc(b.billedTo)}` : "No buyer name on the bill, so it is not in the firm's name.",
            off ? `<b>The bill total is ${inr(b.totalAmount)}, but the form adds up to ${inr(x.amount + x.gst)}.</b> Check the amount and GST.` : "",
            b.note ? `Note: ${esc(b.note)}` : "",
          ].filter(Boolean).join("<br>"));
        } catch (err) {
          note(`<span class="chip bad">Could not read it</span> ${esc(err.status ? err.message : "No internet.")} The bill is attached; fill the form by hand.`);
        }
      };
      el.querySelector("#scanCam")?.addEventListener("click", async () => {
        try {
          await scan(await takePhoto());
        } catch (err) {
          if (!/cancel/i.test(err.message || "")) toast(err.message || "Camera not available");
        }
      });
      el.querySelector("#scanFile").onchange = async (ev) => {
        try {
          await scan(await fromFileInput(ev.target.files[0]));
        } catch (err) {
          toast(err.message);
        }
      };
      el.querySelector("#cam")?.addEventListener("click", async () => {
        try {
          await attach(await takePhoto());
        } catch (err) {
          if (!/cancel/i.test(err.message || "")) toast(err.message || "Camera not available");
        }
      });
      el.querySelector("#file").onchange = async (ev) => {
        try {
          await attach(await fromFileInput(ev.target.files[0]));
        } catch (err) {
          toast(err.message);
        }
      };
      const showTotals = () => {
        const x = expenseTax(read(el), firm);
        el.querySelector("#tot").innerHTML = `<table class="t"><tr><td>GST on the bill</td><td>${inr(x.gst)}</td></tr><tr><td>Bill total</td><td>${inr(x.amount + x.gst)}</td></tr><tr><td>Cost for profit</td><td>${inr(x.cost)}</td></tr></table>
          <div class="chips">${flags(x) || `<span class="chip">${x.gst > 0 ? "ITC not claimable" : "No GST"}</span>`}</div>`;
      };
      el.addEventListener("input", showTotals);
      el.addEventListener("change", showTotals);
      showRcpt();
      showTotals();
    },
    onSave: (el) => {
      const data = { ...read(el), receipt };
      if (!data.date) throw new Error("Choose the bill date.");
      if (!(data.amount > 0)) throw new Error("Enter the amount before GST.");
      if (!data.vendor && !data.description) throw new Error("Enter the vendor or a description.");
      if (data.vendorGstin && !GSTIN_RE.test(data.vendorGstin)) throw new Error("That vendor GSTIN does not look right (15 characters).");
      put("expense", id, data);
      toast(existing ? "Expense updated" : "Expense saved");
    },
  });
};

const read = (el) => ({
  date: val(el, "date"),
  vendor: val(el, "vendor"),
  vendorGstin: val(el, "vendorGstin").toUpperCase(),
  description: val(el, "description"),
  category: val(el, "category"),
  amount: r2(val(el, "amount")),
  gstRate: Number(val(el, "gstRate")) || 0,
  taxType: val(el, "taxType"),
  paidVia: val(el, "paidVia"),
  inFirmName: checked(el, "inFirmName"),
  businessUse: checked(el, "businessUse"),
});
