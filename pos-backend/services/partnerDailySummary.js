/**
 * Daily WhatsApp summary for a Partners owner (owner, 2026-11-13): once a
 * day, at the hour they chose, yesterday's figures across all their linked
 * stores, on WhatsApp.
 *
 * WhatsApp only lets a business start a chat with an approved template, so
 * this sends the template below and nothing else. Until "kk_daily_summary"
 * is approved on the account with exactly these seven variables, nothing is
 * sent and the Partners page says so. It goes through the CSD inbox like the
 * owner alerts (services/storeAlerts), so it appears in that chat's history
 * and a reply reaches the agents.
 */

const TEMPLATE = "kk_daily_summary";
const WORDING =
  "Hi {{1}}, your KnotKitchen summary for {{2}}: sales {{3}} from {{4}} orders across {{5}}. Top store: {{6}}. Needs attention: {{7}}. Details: knotkitchen.com/partners";
const VARIABLES = (WORDING.match(/\{\{\d+\}\}/g) || []).length;
const DEFAULT_HOUR = 9;

const dayKeyIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const hourIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600 * 1000).getUTCHours();
const yesterdayIST = (d = new Date()) => dayKeyIST(new Date(d.getTime() - 86400000));

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const dayLabel = (ymd) =>
  new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
// Template variables may not hold new lines, tabs or more than four spaces in a row.
const flat = (s, n = 120) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || "-";

/** The owner's settings, defaults filled in. */
const settingsOf = (partner) => {
  const s = partner?.summary || {};
  const hour = Number.isInteger(s.hour) && s.hour >= 6 && s.hour <= 23 ? s.hour : DEFAULT_HOUR;
  return {
    enabled: Boolean(s.enabled),
    phone: String(s.phone || partner?.phone || "").replace(/\D/g, "").slice(-10),
    hour,
    lastSentDay: s.lastSentDay || "",
    lastSentAt: s.lastSentAt || null,
    lastError: s.lastError || "",
  };
};

/**
 * The seven values, from the dashboard's own figures for one day.
 * @param {{ name, day, dash, cards }} input  dash = aggregateDashboard output; cards = storeCards
 */
const summaryValues = ({ name, day, dash, cards = [] }) => {
  const t = dash?.totals || {};
  const stores = dash?.stores || [];
  const top = stores[0];
  const change = top && top.salesChange != null ? ` (${top.salesChange > 0 ? "+" : ""}${top.salesChange}%)` : "";
  const attention = [];
  for (const c of cards) {
    if (c.linkStatus !== "ok") attention.push(`${c.name} needs linking again`);
    else if (c.locked) attention.push(`${c.name} is locked`);
    else if ((c.wallet?.paise ?? 0) < 50000) attention.push(`${c.name} wallet ${c.wallet?.label || rupees(0)}`);
  }
  return [
    flat(name || "there", 40),
    flat(dayLabel(day), 30),
    flat(rupees(t.sales), 20),
    flat(String(t.orders || 0), 10),
    flat(`${stores.length || cards.length} store${(stores.length || cards.length) === 1 ? "" : "s"}`, 20),
    top && top.sales > 0 ? flat(`${top.name} ${rupees(top.sales)}${change}`, 80) : "no sales yet",
    attention.length ? flat(attention.slice(0, 3).join(", ") + (attention.length > 3 ? ` and ${attention.length - 3} more` : ""), 160) : "nothing",
  ];
};

const preview = (values) => WORDING.replace(/\{\{(\d+)\}\}/g, (_, i) => values[Number(i) - 1] ?? "");

/** Yesterday's figures for one partner, as the dashboard would show them. */
const collect = async (partner, day) => {
  const { PartnerLink } = require("../models/partnerModel");
  const { ownerForLink, storeCards } = require("./partners");
  const { reportFor } = require("../controllers/orderController");
  const { aggregateDashboard } = require("./partnerDashboard");
  const links = await PartnerLink.find({ partnerId: partner._id }).sort({ linkedAt: 1 });
  const cards = await storeCards(partner);
  const nameOf = new Map(cards.map((c) => [c.storeId, c.name]));
  const prevDay = dayKeyIST(new Date(new Date(`${day}T12:00:00+05:30`).getTime() - 86400000));
  const stores = [];
  for (const link of links) {
    let owner;
    try {
      owner = await ownerForLink(link);
    } catch {
      continue; // shown under "needs attention" from its card
    }
    const [report, previous] = await Promise.all([reportFor(owner, { from: day, to: day }), reportFor(owner, { from: prevDay, to: prevDay })]);
    stores.push({ storeId: link.storeId, name: nameOf.get(link.storeId) || link.storeId, report, previous });
  }
  return { dash: aggregateDashboard({ stores }), cards };
};

/** Is the template approved and does it take exactly our seven values? Cached 10 minutes (a provider call). */
let readyCache = { at: 0, value: null };
const templateReady = async () => {
  if (readyCache.value && Date.now() - readyCache.at < 10 * 60 * 1000) return readyCache.value;
  readyCache = { at: Date.now(), value: await checkTemplate() };
  return readyCache.value;
};
const checkTemplate = async () => {
  const wa = require("./whatsapp");
  if (!wa.isConfigured()) return { ready: false, reason: "WhatsApp is not connected on this server yet." };
  try {
    const tpl = (await wa.listTemplates()).find((t) => t.name === TEMPLATE);
    if (!tpl) return { ready: false, reason: `The WhatsApp template "${TEMPLATE}" is not approved yet.` };
    if (!tpl.supported || tpl.variables.length !== VARIABLES) return { ready: false, reason: `The WhatsApp template "${TEMPLATE}" does not match (it needs exactly ${VARIABLES} text variables).` };
    return { ready: true, tpl };
  } catch (err) {
    return { ready: false, reason: `Could not check WhatsApp templates: ${err.message}` };
  }
};

/** Build and send one partner's summary for `day`. Throws with a sentence for the owner. */
const sendSummary = async (partner, { day = yesterdayIST(), check } = {}) => {
  const s = settingsOf(partner);
  const wa = require("./whatsapp");
  const waId = wa.normaliseWaId(s.phone.length === 10 ? `91${s.phone}` : s.phone);
  if (!waId) throw Object.assign(new Error("Enter a valid 10-digit WhatsApp number."), { status: 400 });
  const status = check || (await templateReady());
  if (!status.ready) throw Object.assign(new Error(status.reason), { status: 409, code: "TEMPLATE_NOT_READY" });
  const { dash, cards } = await collect(partner, day);
  const values = summaryValues({ name: partner.name, day, dash, cards });
  const { findOrCreateConversation, sendOutbound } = require("./whatsappInbox");
  const { WaConversation } = require("../models/waChatModel");
  const conv = await findOrCreateConversation({ waId, profileName: "" });
  const numbered = Object.fromEntries(values.map((v, i) => [String(i + 1), v]));
  await sendOutbound({ conv: conv.toObject ? conv.toObject() : conv, template: { ...status.tpl, values: numbered }, actor: { id: null, name: "Partners daily summary" }, claim: false });
  // An owner who never wrote is not a chat for agents to work: file it closed; a reply re-opens it.
  if (!conv.lastInboundAt && !conv.assignedToId) await WaConversation.updateOne({ _id: conv._id }, { $set: { status: "closed" } });
  return { values, text: preview(values) };
};

/** Every owner whose hour it is and who has not had today's: claim the day, then send. */
const runDue = async (now = new Date()) => {
  const { PartnerAccount } = require("../models/partnerModel");
  const day = dayKeyIST(now);
  const hour = hourIST(now);
  const due = await PartnerAccount.find({ "summary.enabled": true, "summary.lastSentDay": { $ne: day } }).select("name phone summary").lean();
  const mine = due.filter((p) => settingsOf(p).hour === hour);
  if (!mine.length) return { sent: 0 };
  const check = await templateReady();
  let sent = 0;
  for (const p of mine) {
    // Claim first: another API instance, or the next tick, must not send it twice.
    const { modifiedCount } = await PartnerAccount.updateOne({ _id: p._id, "summary.lastSentDay": { $ne: day } }, { $set: { "summary.lastSentDay": day } });
    if (!modifiedCount) continue;
    try {
      await sendSummary(p, { day: yesterdayIST(now), check });
      await PartnerAccount.updateOne({ _id: p._id }, { $set: { "summary.lastSentAt": new Date(), "summary.lastError": "" } });
      sent += 1;
    } catch (err) {
      await PartnerAccount.updateOne({ _id: p._id }, { $set: { "summary.lastError": String(err.message || "Not sent").slice(0, 300) } });
    }
  }
  return { sent };
};

let timer = null;
const startDailySummaryScheduler = () => {
  if (timer) return;
  timer = setInterval(() => {
    runDue().catch((err) => console.error("[partner-summary] run failed:", err?.message)); // eslint-disable-line no-console
  }, 10 * 60 * 1000);
  timer.unref?.();
};

module.exports = { _resetCache: () => { readyCache = { at: 0, value: null }; }, TEMPLATE, WORDING, VARIABLES, settingsOf, summaryValues, preview, collect, templateReady, sendSummary, runDue, startDailySummaryScheduler, yesterdayIST, dayKeyIST };
