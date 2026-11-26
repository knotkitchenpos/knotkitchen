import { list, put, remove, get, dump, restore, sync, unsyncedCount } from "../lib/store.js";
import { firm as getFirm, STATES, GST_RATES } from "../lib/firm.js";
import { inFy, today, dateLabel } from "../lib/fy.js";
import { inr, r2 } from "../lib/money.js";
import { api, getAuth } from "../lib/api.js";
import { applyTheme } from "../lib/theme.js";
import { toCsv } from "../lib/gst.js";
import { expenseTax } from "../lib/tax.js";
import { esc, uid, openSheet, confirmBox, field, select, check, val, checked, toast, shareFile } from "../lib/ui.js";

const TYPES = [["in", "Capital in"], ["drawing", "Drawing"], ["remuneration", "Remuneration"], ["interest", "Interest on capital"]];
const typeLabel = (t) => (TYPES.find(([k]) => k === t) || [, t])[1];
// What the firm owes the partner: money put in and what they earned, less what they took out.
const signOf = (t) => (t === "drawing" ? -1 : 1);

let section = "partners";

export const renderMore = (el, ctx) => {
  el.innerHTML = `<div class="seg"><button data-s="partners" class="${section === "partners" ? "on" : ""}">Partners</button><button data-s="settings" class="${section === "settings" ? "on" : ""}">Settings</button></div><div id="sub"></div>`;
  el.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { section = b.dataset.s; ctx.rerender(); }));
  (section === "partners" ? renderPartners : renderSettings)(el.querySelector("#sub"), ctx);
};

// ---- partners -------------------------------------------------------------

const renderPartners = (el, ctx) => {
  const firm = getFirm();
  const all = list("capital").sort((a, b) => a.date.localeCompare(b.date));
  const names = [...new Set([...firm.partners.map((p) => p.name), ...all.map((c) => c.partner)])].filter(Boolean);
  const balance = (n) => r2(all.filter((c) => c.partner === n).reduce((s, c) => s + signOf(c.type) * (Number(c.amount) || 0), 0));
  const fyEntries = all.filter((c) => inFy(c.date, ctx.fy)).reverse();
  // Running balance per partner up to each entry.
  const running = {};
  const after = new Map();
  for (const c of all) {
    running[c.partner] = r2((running[c.partner] || 0) + signOf(c.type) * (Number(c.amount) || 0));
    after.set(c.id, running[c.partner]);
  }
  el.innerHTML = `
    <div class="grid">${names.map((n) => `<div class="stat"><div class="label">${esc(n)}</div><div class="val">${inr(balance(n))}</div><div class="muted small">${esc(firm.partners.find((p) => p.name === n)?.share ?? "")}${firm.partners.find((p) => p.name === n) ? "% share" : ""}</div></div>`).join("")}</div>
    <div class="section"><h2>Entries in ${esc(ctx.fy)}</h2><span>balance = in + remuneration + interest − drawings</span></div>
    ${fyEntries.length ? fyEntries.map((c) => `
      <button class="card" data-id="${esc(c.id)}">
        <div class="row"><b>${esc(c.partner)}</b><b>${c.type === "drawing" ? "−" : "+"}${inr(c.amount)}</b></div>
        <div class="row muted"><span>${dateLabel(c.date)} · ${esc(typeLabel(c.type))}${c.note ? ` · ${esc(c.note)}` : ""}</span><span>bal ${inr(after.get(c.id))}</span></div>
      </button>`).join("") : `<div class="empty"><b>No partner entries in ${esc(ctx.fy)}</b>Tap + and choose Partner entry.</div>`}`;
  el.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => capitalForm(ctx, get(b.dataset.id))));
};

export const capitalForm = (ctx, existing) => {
  const firm = getFirm();
  const c = existing || { date: today(), partner: firm.partners[0]?.name || "", type: "in" };
  const id = existing?.id || uid();
  openSheet({
    title: existing ? "Edit partner entry" : "Partner entry",
    body: `
      <div class="f2">${field("Date", "date", c.date, 'type="date"')}${select("Partner", "partner", firm.partners.map((p) => p.name), c.partner)}</div>
      <div class="f2">${select("Type", "type", TYPES, c.type)}${field("Amount (₹)", "amount", c.amount ?? "", 'type="number" inputmode="decimal" step="0.01"')}</div>
      ${field("Note", "note", c.note || "")}`,
    actions: existing ? [{ label: "Delete", cls: "danger", onClick: async (close) => {
      if (await confirmBox("Delete this partner entry? This cannot be undone.")) {
        remove(id);
        close();
        toast("Entry deleted");
      }
    } }] : [],
    onSave: (el) => {
      const data = { date: val(el, "date"), partner: val(el, "partner"), type: val(el, "type"), amount: r2(val(el, "amount")), note: val(el, "note") };
      if (!data.date || !data.partner) throw new Error("Choose the date and partner.");
      if (!(data.amount > 0)) throw new Error("Enter the amount.");
      put("capital", id, data);
      toast("Saved");
    },
  });
};

// ---- settings -------------------------------------------------------------

const renderSettings = (el, ctx) => {
  const f = getFirm();
  const theme = localStorage.getItem("kkb.theme") || "system";
  el.innerHTML = `
    <div class="card">
      <div class="row"><b>Firm details</b><button class="btn" id="edit" style="padding:6px 14px">Edit</button></div>
      <div class="muted small" style="margin-top:6px">${esc(f.name)}<br>${esc(f.address)}<br>${esc(f.state)}${f.pan ? ` · PAN ${esc(f.pan)}` : ""}<br>
      ${f.gstin ? `GSTIN ${esc(f.gstin)} from ${dateLabel(f.gstFrom)} · ${f.qrmp !== false ? "QRMP" : "monthly returns"}` : "Not registered under GST"}<br>
      Invoices ${esc(f.prefix)}/FY/### · SAC ${esc(f.sac)} · GST ${esc(f.gstRate)}%<br>
      Partners: ${f.partners.map((p) => `${esc(p.name)} (${esc(p.share)}%)`).join(", ")}</div>
    </div>
    <div class="card">
      <b>Theme</b>
      <div class="seg" style="margin:8px 0 0">${["system", "light", "dark"].map((t) => `<button data-t="${t}" class="${t === theme ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
    </div>
    <div class="card">
      <b>Who can use the app</b>
      <div id="access" class="muted small" style="margin-top:6px">Loading…</div>
    </div>
    <div class="card">
      <b>Backup</b>
      <p class="muted small">A JSON file with every invoice, expense, partner entry and the settings. Restoring adds or replaces records; it never deletes any.</p>
      <div class="f2"><button class="btn" id="backup">Export backup</button><label class="btn" style="text-align:center">Restore<input type="file" id="restore" accept="application/json,.json" hidden></label></div>
      <button class="btn" id="csv" style="width:100%;margin-top:8px">Export ${esc(ctx.fy)} as CSV</button>
    </div>
    <div class="card row"><span class="muted small">Signed in as ${esc(getAuth()?.email || "")}</span><button class="btn danger" id="out" style="padding:6px 14px">Sign out</button></div>`;

  el.querySelector("#edit").onclick = () => firmForm(ctx);
  el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { localStorage.setItem("kkb.theme", b.dataset.t); applyTheme(); ctx.rerender(); }));
  el.querySelector("#out").onclick = async () => {
    await sync();
    const waiting = unsyncedCount();
    const msg = waiting
      ? `${waiting} change${waiting === 1 ? " has" : "s have"} not reached the server yet (no internet?). Signing out now loses ${waiting === 1 ? "it" : "them"}. Sign out anyway?`
      : "Sign out? The books stay on the server; this phone forgets them until you sign in again.";
    if (await confirmBox(msg, "Sign out")) ctx.signOut();
  };
  el.querySelector("#backup").onclick = async () => {
    const blob = new Blob([JSON.stringify({ app: "KnotKitchen Books", exportedAt: new Date().toISOString(), records: dump() }, null, 2)], { type: "application/json" });
    try {
      await shareFile(`KnotKitchen-Books-backup-${today()}.json`, blob, "Books backup");
    } catch (err) {
      if (!/cancel/i.test(err.message || "")) toast(err.message);
    }
  };
  el.querySelector("#restore").onchange = async (ev) => {
    try {
      const data = JSON.parse(await ev.target.files[0].text());
      const records = Array.isArray(data.records) ? data.records : [];
      if (!records.length) throw new Error("No records in that file.");
      if (!(await confirmBox(`Restore ${records.length} records? Records with the same ID are replaced.`, "Restore"))) return;
      restore(records);
      sync();
      toast(`Restored ${records.length} records`);
    } catch (err) {
      toast(err.message || "Not a backup file");
    }
  };
  el.querySelector("#csv").onclick = async () => {
    const rows = [["Type", "Date", "Number", "Party", "GSTIN", "Category / place", "Taxable", "CGST", "SGST", "IGST", "Total", "Paid / ITC"]];
    for (const i of list("invoice").filter((x) => inFy(x.date, ctx.fy)).sort((a, b) => a.date.localeCompare(b.date))) {
      const t = i.totals || {};
      rows.push(["Invoice", i.date, i.no, i.client, i.clientGstin, i.pos, t.taxable, t.cgst, t.sgst, t.igst, t.total, (i.payments || []).reduce((s, p) => s + p.amount, 0)]);
    }
    for (const e of list("expense").filter((x) => inFy(x.date, ctx.fy)).sort((a, b) => a.date.localeCompare(b.date))) {
      const x = expenseTax(e, f);
      rows.push(["Expense", e.date, "", e.vendor, e.vendorGstin, e.category, x.amount, x.cgst, x.sgst, x.igst, r2(x.amount + x.gst), x.claimable ? "ITC" : ""]);
    }
    for (const c of list("capital").filter((x) => inFy(x.date, ctx.fy)).sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([`Partner: ${typeLabel(c.type)}`, c.date, "", c.partner, "", c.note, "", "", "", "", c.amount, ""]);
    }
    try {
      await shareFile(`KnotKitchen-Books-${ctx.fy}.csv`, new Blob([toCsv(rows)], { type: "text/csv" }), `Books ${ctx.fy}`);
    } catch (err) {
      if (!/cancel/i.test(err.message || "")) toast(err.message);
    }
  };
  loadAccess(el.querySelector("#access"));
};

const loadAccess = async (box) => {
  try {
    const { allowedUsers } = await api("/access");
    box.innerHTML = `${allowedUsers.map((e) => esc(e)).join("<br>")}<br><button class="btn" id="acc" style="margin-top:8px;padding:6px 14px">Change</button>`;
    box.querySelector("#acc").onclick = () =>
      openSheet({
        title: "Who can use the app",
        full: false,
        body: `<label class="f"><span>Google accounts (one email per line)</span><textarea name="emails" rows="4">${esc(allowedUsers.join("\n"))}</textarea></label><p class="muted small">Someone taken off this list is signed out at their next sync.</p>`,
        onSave: async (el) => {
          const emails = val(el, "emails").split(/[\s,]+/).filter(Boolean);
          await api("/access", { method: "PUT", body: { allowedUsers: emails } });
          toast("Access list saved");
          loadAccess(box);
        },
      });
  } catch (err) {
    box.textContent = err.status ? err.message : "Connect to the internet to see or change this.";
  }
};

const firmForm = (ctx) => {
  const f = getFirm();
  openSheet({
    title: "Firm details",
    body: `
      ${field("Firm name", "name", f.name)}
      <label class="f"><span>Address</span><textarea name="address" rows="3">${esc(f.address)}</textarea></label>
      <div class="f2">${select("State", "state", STATES, f.state)}${field("PAN", "pan", f.pan, 'maxlength="10" style="text-transform:uppercase"')}</div>
      <div class="section"><h2>GST</h2></div>
      <div class="f2">${field("GSTIN", "gstin", f.gstin, 'maxlength="15" style="text-transform:uppercase"')}${field("Registered from", "gstFrom", f.gstFrom, 'type="date"')}</div>
      ${check("Quarterly returns (QRMP)", "qrmp", f.qrmp !== false)}
      <div class="section"><h2>Invoices</h2></div>
      <div class="f3">${field("Prefix", "prefix", f.prefix, 'maxlength="4"')}${field("Default SAC", "sac", f.sac, 'inputmode="numeric"')}${select("Default GST %", "gstRate", GST_RATES, f.gstRate)}</div>
      <div class="section"><h2>Bank (printed on invoices)</h2></div>
      ${field("Bank name", "bankName", f.bankName)}
      <div class="f2">${field("Account number", "bankAccount", f.bankAccount, 'inputmode="numeric"')}${field("IFSC", "bankIfsc", f.bankIfsc, 'style="text-transform:uppercase"')}</div>
      ${field("Branch", "bankBranch", f.bankBranch)}
      <div class="f2">${field("Email", "email", f.email, 'type="email"')}${field("Phone", "phone", f.phone, 'type="tel"')}</div>
      <div class="section"><h2>Partners</h2></div>
      ${f.partners.map((p, i) => `<div class="f3"><label class="f"><span>Partner ${i + 1}</span><input data-pn="${i}" value="${esc(p.name)}"></label><label class="f"><span>Share %</span><input data-ps="${i}" type="number" value="${esc(p.share)}"></label><span></span></div>`).join("")}`,
    onSave: (el) => {
      const partners = f.partners.map((_, i) => ({ name: el.querySelector(`[data-pn="${i}"]`).value.trim(), share: Number(el.querySelector(`[data-ps="${i}"]`).value) || 0 })).filter((p) => p.name);
      const data = {
        name: val(el, "name"), address: val(el, "address"), state: val(el, "state"), pan: val(el, "pan").toUpperCase(),
        gstin: val(el, "gstin").toUpperCase(), gstFrom: val(el, "gstFrom"), qrmp: checked(el, "qrmp"),
        prefix: val(el, "prefix").toUpperCase() || "KK", sac: val(el, "sac"), gstRate: Number(val(el, "gstRate")),
        bankName: val(el, "bankName"), bankAccount: val(el, "bankAccount"), bankIfsc: val(el, "bankIfsc").toUpperCase(), bankBranch: val(el, "bankBranch"),
        email: val(el, "email"), phone: val(el, "phone"), partners,
      };
      if (!data.name) throw new Error("Enter the firm name.");
      if (data.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(data.gstin)) throw new Error("That GSTIN does not look right (15 characters).");
      if (data.gstin && !data.gstFrom) throw new Error("Enter the GST registration date too.");
      if (data.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(data.pan)) throw new Error("That PAN does not look right (e.g. ABCDE1234F).");
      if (partners.length && Math.round(partners.reduce((s, p) => s + p.share, 0)) !== 100) throw new Error("Partner shares must add up to 100%.");
      put("settings", "firm", data);
      toast("Firm details saved. Existing invoices keep the GST worked out when they were saved.");
      ctx.rerender();
    },
  });
};
