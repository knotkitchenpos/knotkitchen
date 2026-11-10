const { StoreAlert, StoreAlertSettings } = require("../models/csdStoreAlertModel");
const { WaConversation } = require("../models/waChatModel");
const wa = require("./whatsapp");
const { findOrCreateConversation, sendOutbound } = require("./whatsappInbox");
const { computeHealth, rupees, dateIST, dateTimeIST } = require("./storeHealth");

/**
 * Proactive WhatsApp alerts to store owners, before they have to complain.
 *
 * WhatsApp only allows a business to start a chat with an approved template,
 * so each kind names one. Until that template is approved on the account, the
 * alert simply cannot be sent and CSD says which template is missing.
 *
 * Alerts go through the inbox, so they appear in that owner's chat history and
 * a reply lands with the agents. A store gets the same kind of alert at most
 * once in COOLDOWN_DAYS. Automatic sending is off until an admin turns it on.
 */

const COOLDOWN_DAYS = 3;
const SETTINGS_ID = "store-alerts";
const AUTO_HOUR_IST = 11;

/** Template variable order is the contract: {{1}}, {{2}}… in the approved text. */
const KINDS = {
  wallet_low: {
    label: "Wallet low",
    template: "kk_wallet_low",
    wording: "Hi {{1}}, the KnotKitchen wallet for {{2}} has only {{3}} left. Please recharge from POS Billing so your service is not interrupted.",
    values: (store, issue) => [store.ownerName, store.storeName, rupees(issue.balancePaise)],
  },
  device_offline: {
    label: "Tablet offline",
    template: "kk_device_offline",
    wording: "Hi {{1}}, your KnotKitchen device {{2}} at {{3}} has been offline since {{4}}. Please check its power and internet, or reply here for help.",
    values: (store, issue) => [store.ownerName, issue.deviceName, store.storeName, issue.lastSeenAt ? dateTimeIST(issue.lastSeenAt) : "setup"],
  },
  subscription_ending: {
    label: "Subscription ending",
    template: "kk_subscription_ending",
    wording: "Hi {{1}}, the KnotKitchen subscription for {{2}} ends on {{3}} and your wallet does not have enough to renew it. Please recharge from POS Billing.",
    values: (store, issue) => [store.ownerName, store.storeName, issue.endsAt ? dateIST(issue.endsAt) : "soon"],
  },
};

const dayKeyIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const getSettings = async () => (await StoreAlertSettings.findById(SETTINGS_ID).lean()) || { autoEnabled: false };

const setAuto = async (autoEnabled, staffName) =>
  StoreAlertSettings.findOneAndUpdate({ _id: SETTINGS_ID }, { $set: { autoEnabled: !!autoEnabled, updatedByName: staffName } }, { upsert: true, new: true }).lean();

/** Which alert kinds can be sent right now (their template is approved and fits). */
const templateStatus = async () => {
  let approved = [];
  let error = "";
  try {
    approved = await wa.listTemplates();
  } catch (err) {
    error = err.message;
  }
  const out = {};
  for (const [kind, def] of Object.entries(KINDS)) {
    const need = (def.wording.match(/\{\{\d+\}\}/g) || []).length;
    const tpl = approved.find((t) => t.name === def.template);
    out[kind] = { label: def.label, template: def.template, wording: def.wording, ready: !!tpl && tpl.supported && tpl.variables.length === need, tpl: tpl || null };
  }
  return { kinds: out, error };
};

class AlertError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

/** When each store last got each kind, for the list. */
const lastSent = async (storeIds) => {
  const rows = await StoreAlert.aggregate([
    { $match: { storeId: { $in: storeIds }, status: "sent" } },
    { $sort: { sentAt: -1 } },
    { $group: { _id: { s: "$storeId", k: "$kind" }, at: { $first: "$sentAt" } } },
  ]);
  const map = {};
  for (const r of rows) (map[r._id.s] ||= {})[r._id.k] = r.at;
  return map;
};

/**
 * Send one alert. `actor` is { id, name } for an agent, or null for the
 * automatic sweep. Throws AlertError with a sentence for the agent.
 */
const sendAlert = async ({ store, issue, actor = null, templates, now = new Date() }) => {
  const def = KINDS[issue.kind];
  if (!def) throw new AlertError("That problem has no customer alert.", 400);
  if (!wa.isConfigured()) throw new AlertError("WhatsApp is not connected on this server.", 503);

  const status = (templates || (await templateStatus())).kinds[issue.kind];
  if (!status.ready) throw new AlertError(`The WhatsApp template "${def.template}" is not approved yet.`);

  const since = new Date(now.getTime() - COOLDOWN_DAYS * 86400000);
  const recent = await StoreAlert.findOne({ storeId: store.storeId, kind: issue.kind, status: "sent", sentAt: { $gte: since } }).lean();
  if (recent) throw new AlertError(`This store already got this alert on ${dateIST(recent.sentAt)}. It can be sent again after ${COOLDOWN_DAYS} days.`);

  const waId = wa.normaliseWaId(store.ownerPhone);
  if (!waId) throw new AlertError("This store has no valid owner phone number.", 400);

  // Claim the day first: the unique index makes a concurrent send lose here.
  let row;
  const dayKey = dayKeyIST(now);
  try {
    await StoreAlert.deleteOne({ storeId: store.storeId, kind: issue.kind, dayKey, status: "failed" });
    row = await StoreAlert.create({ storeId: store.storeId, kind: issue.kind, dayKey, auto: !actor, staffId: actor?.id || null, staffName: actor?.name || "Automatic alert" });
  } catch (err) {
    if (err?.code === 11000) throw new AlertError("This alert is already being sent.");
    throw err;
  }

  try {
    const conv = await findOrCreateConversation({ waId, profileName: "" });
    const numbered = {};
    def.values(store, issue).forEach((v, i) => { numbered[String(i + 1)] = String(v ?? ""); });
    const message = await sendOutbound({
      conv: conv.toObject ? conv.toObject() : conv,
      template: { ...status.tpl, values: numbered },
      actor: actor || { id: null, name: "Automatic alert" },
      claim: false, // an alert is not an agent taking the chat
    });
    // An owner who never wrote is not a chat for agents to work: file it closed.
    // Their reply re-opens it. Without this, automatic alerts would flood the queue.
    if (!conv.lastInboundAt && !conv.assignedToId) await WaConversation.updateOne({ _id: conv._id }, { $set: { status: "closed" } });
    await StoreAlert.updateOne({ _id: row._id }, { $set: { status: "sent", sentAt: new Date() } });
    return message;
  } catch (err) {
    await StoreAlert.updateOne({ _id: row._id }, { $set: { status: "failed", error: String(err.message || "").slice(0, 300) } });
    throw err;
  }
};

/** Once a day, if an admin switched it on: every alert that is due. */
const runAutoSweep = async (now = new Date()) => {
  const settings = await getSettings();
  if (!settings.autoEnabled || !wa.isConfigured()) return { sent: 0, skipped: "off" };
  const templates = await templateStatus();
  const { rows } = await computeHealth(now);
  let sent = 0;
  for (const store of rows) {
    for (const issue of store.issues) {
      if (!KINDS[issue.kind] || !templates.kinds[issue.kind].ready) continue;
      try {
        await sendAlert({ store, issue, templates, now });
        sent += 1;
      } catch (err) {
        if (!(err instanceof AlertError)) console.error("[alerts] send failed:", err?.message); // eslint-disable-line no-console
      }
    }
  }
  return { sent };
};

let timer = null;
let lastRunDay = "";
/** Checks hourly; runs once in the 11:00 IST hour, when owners are at work and before lunch service. */
const startAlertScheduler = () => {
  if (timer) return;
  timer = setInterval(() => {
    const now = new Date();
    const hourIST = new Date(now.getTime() + 5.5 * 3600 * 1000).getUTCHours();
    const day = dayKeyIST(now);
    if (hourIST !== AUTO_HOUR_IST || lastRunDay === day) return;
    lastRunDay = day;
    runAutoSweep(now).catch((err) => console.error("[alerts] sweep failed:", err?.message)); // eslint-disable-line no-console
  }, 10 * 60 * 1000);
  timer.unref?.();
};

module.exports = { KINDS, COOLDOWN_DAYS, getSettings, setAuto, templateStatus, lastSent, sendAlert, runAutoSweep, startAlertScheduler, AlertError, dayKeyIST };
