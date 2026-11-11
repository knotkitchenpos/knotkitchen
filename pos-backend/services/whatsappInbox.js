const mongoose = require("mongoose");
const { WaConversation, WaMessage, WaRating } = require("../models/waChatModel");
const { notifyWhatsApp } = require("./csdPush");
const wa = require("./whatsapp");

/**
 * Writes provider events (services/whatsapp.js parse*) into the inbox:
 * customer messages, messages sent from another app, and delivery receipts.
 *
 * Providers retry webhooks, so everything here is idempotent: a message is
 * keyed by the provider's message id (unique index), and a receipt only ever
 * moves a message's status forward.
 */

const RATING_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const RATING_ASK = "Thank you for contacting KnotKitchen. How did we do? Please reply with a number from 1 (poor) to 5 (excellent).";
const RATING_THANKS = "Thank you for your feedback!";
const SYSTEM_ACTOR = { id: null, name: "Automatic message" };

/** A reply that is only a 1-5 (Latin, Hindi or Bengali digits, or a keycap emoji). */
const ratingFrom = (text) => {
  const t = String(text || "")
    .replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/[\u09E6-\u09EF]/g, (d) => String(d.charCodeAt(0) - 0x09E6))
    .replace(/[\uFE0F\u20E3\u2B50]/g, "")
    .trim();
  return /^[1-5]$/.test(t) ? Number(t) : null;
};

const RANK = { pending: 0, sent: 1, delivered: 2, read: 3 };

const preview = (m) => {
  const label = { image: "Photo", video: "Video", audio: "Voice message", document: "Document", sticker: "Sticker" }[m.type];
  const text = String(m.body || "").replace(/\s+/g, " ").trim();
  return (label ? (text ? `${label}: ${text}` : label) : text || `[${m.type || "message"}]`).slice(0, 140);
};

/** A status may replace the current one: forward only; failed unless it already arrived. */
const advances = (current, next) => {
  if (next === "failed") return !["delivered", "read"].includes(current);
  if (current === "failed") return false;
  return (RANK[next] ?? -1) > (RANK[current] ?? -1);
};

const applyStatus = async (e) => {
  const or = [];
  if (e.providerMessageId) or.push({ providerMessageId: e.providerMessageId });
  if (e.refId && mongoose.Types.ObjectId.isValid(e.refId)) or.push({ _id: new mongoose.Types.ObjectId(e.refId) });
  if (!or.length) return false;
  const msg = await WaMessage.findOne({ $or: or, direction: "out" });
  if (!msg) return false;
  let changed = false;
  if (!msg.providerMessageId && e.providerMessageId) { msg.providerMessageId = e.providerMessageId; changed = true; }
  if (advances(msg.status, e.status)) {
    msg.status = e.status;
    msg.error = e.status === "failed" ? e.error || "" : "";
    changed = true;
  }
  if (changed) await msg.save();
  return changed;
};

const findOrCreateConversation = async ({ waId, profileName, providerConversationId }) => {
  const set = {};
  if (profileName) set.profileName = profileName;
  if (providerConversationId) set.providerConversationId = providerConversationId;
  try {
    return await WaConversation.findOneAndUpdate(
      { waId },
      { $set: set, $setOnInsert: { waId, status: "open" } },
      { new: true, upsert: true }
    );
  } catch (err) {
    // Two webhooks for a brand-new customer at once: the other insert won.
    if (err?.code === 11000) return WaConversation.findOneAndUpdate({ waId }, { $set: set }, { new: true });
    throw err;
  }
};

const addMessage = async (e) => {
  // Our own message coming back as "sent" from the provider: just a receipt.
  if (e.refId && mongoose.Types.ObjectId.isValid(e.refId) && (await WaMessage.exists({ _id: e.refId }))) {
    await applyStatus({ ...e, status: e.status || "sent" });
    return false;
  }
  if (e.providerMessageId && (await WaMessage.exists({ providerMessageId: e.providerMessageId }))) return false;

  const conv = await findOrCreateConversation(e);
  try {
    await WaMessage.create({
      conversationId: conv._id,
      direction: e.direction,
      type: e.type || "text",
      body: e.body || "",
      media: e.media || undefined,
      template: e.template || undefined,
      providerMessageId: e.providerMessageId || undefined,
      status: e.direction === "in" ? "received" : e.status || "sent",
      external: !!e.external,
      sentAt: e.at || new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) return false; // a retry raced us
    throw err;
  }

  const at = e.at || new Date();

  // The answer to a rating request: recorded, and not a new problem to work on.
  const score = e.direction === "in" && (!e.type || e.type === "text") && conv.ratingRequestedAt && at - new Date(conv.ratingRequestedAt) < RATING_WINDOW_MS ? ratingFrom(e.body) : null;
  if (score) {
    await WaRating.create({ conversationId: conv._id, waId: conv.waId, score, agentId: conv.ratingForId || null, agentName: conv.ratingForName || "", at });
    await WaConversation.updateOne({ _id: conv._id }, { $set: { ratingRequestedAt: null, lastMessagePreview: preview(e), lastMessageDirection: "in" }, $max: { lastMessageAt: at, lastInboundAt: at } });
    sendOutbound({ conv, text: RATING_THANKS, actor: SYSTEM_ACTOR, claim: false }).catch(() => {});
    return true;
  }

  const update = { $max: { lastMessageAt: at } };
  if (e.direction === "in") {
    update.$max.lastInboundAt = at;
    update.$inc = { unreadCount: 1 };
    // A customer writing again re-opens a closed conversation.
    update.$set = { status: "open" };
  }
  await WaConversation.updateOne({ _id: conv._id }, update);
  // Preview follows the newest message, which a late retry may not be.
  await WaConversation.updateOne(
    { _id: conv._id, lastMessageAt: { $lte: at } },
    { $set: { lastMessagePreview: preview(e), lastMessageDirection: e.direction } }
  );
  // A customer wrote: alert the agents' devices. Not awaited, so a slow push
  // service never holds up the provider's webhook (it would retry).
  if (e.direction === "in") notifyWhatsApp(conv, e);
  return true;
};

/** Apply parsed events in order. Returns how many changed something. */
const ingest = async (events) => {
  let n = 0;
  for (const e of events || []) {
    if (e.kind === "message") n += (await addMessage(e)) ? 1 : 0;
    else if (e.kind === "status") n += (await applyStatus(e)) ? 1 : 0;
  }
  return n;
};

/**
 * Send one outbound message on a conversation: saved first, so a receipt can
 * never beat it. `actor` is { id, name }. `claim`: a reply to an unassigned
 * chat takes it, so two agents do not both answer; an automatic alert does not.
 * Throws what the provider threw, after recording the failure on the message.
 */
const sendOutbound = async ({ conv, text, template, media, actor, claim = true }) => {
  const msg = await WaMessage.create({
    conversationId: conv._id,
    direction: "out",
    type: media ? media.kind : template ? "template" : "text",
    body: media ? media.caption || "" : template ? wa.fillTemplate([template.header, template.body, template.footer].filter(Boolean).join("\n\n"), template.values) : text,
    media: media ? { url: `local:${media.storageKey}`, mimeType: media.mimeType, filename: media.filename || "" } : undefined,
    template: template ? { name: template.name, language: template.language } : undefined,
    status: "pending",
    staffId: actor.id || null,
    staffName: actor.name,
    sentAt: new Date(),
  });

  let failure = null;
  try {
    const r = await wa.send({ waId: conv.waId, countryCode: "", refId: String(msg._id), text, template, media });
    const set = { status: "sent" };
    if (r.providerMessageId) set.providerMessageId = r.providerMessageId;
    // A receipt may already have moved it past "sent"; never move it back.
    await WaMessage.updateOne({ _id: msg._id, status: "pending" }, { $set: set });
    if (r.providerMessageId) await WaMessage.updateOne({ _id: msg._id, providerMessageId: { $exists: false } }, { $set: { providerMessageId: r.providerMessageId } }).catch(() => {});
    if (r.providerConversationId && !conv.providerConversationId) {
      await WaConversation.updateOne({ _id: conv._id }, { $set: { providerConversationId: r.providerConversationId } });
    }
  } catch (err) {
    failure = err;
    await WaMessage.updateOne({ _id: msg._id }, { $set: { status: "failed", error: String(err.message || "Not sent").slice(0, 500) } });
  }

  const update = {
    $set: { lastMessageAt: msg.sentAt, lastMessagePreview: preview(msg), lastMessageDirection: "out" },
  };
  if (claim) update.$set.unreadCount = 0;
  if (claim && !conv.assignedToId && !failure && actor.id) {
    Object.assign(update.$set, { assignedToId: actor.id, assignedToName: actor.name, assignedAt: new Date() });
  }
  await WaConversation.updateOne({ _id: conv._id }, update);

  if (failure) throw failure;
  return WaMessage.findById(msg._id).lean();
};

/**
 * Ask for a 1-5 rating as a chat closes. Only when an agent actually answered
 * the customer's last message, inside WhatsApp's 24-hour window, and not more
 * than once a week per customer. Never throws: closing a chat must not fail.
 */
const requestRating = async (conv, agent) => {
  try {
    if (!wa.isConfigured() || !conv.lastInboundAt) return false;
    const now = Date.now();
    if (now - new Date(conv.lastInboundAt).getTime() >= RATING_WINDOW_MS) return false;
    if (conv.lastRatingAskAt && now - new Date(conv.lastRatingAskAt).getTime() < RATING_COOLDOWN_MS) return false;
    const answered = await WaMessage.exists({ conversationId: conv._id, direction: "out", staffId: { $ne: null }, status: { $ne: "failed" }, sentAt: { $gte: conv.lastInboundAt } });
    if (!answered) return false;
    await sendOutbound({ conv, text: RATING_ASK, actor: SYSTEM_ACTOR, claim: false });
    await WaConversation.updateOne({ _id: conv._id }, { $set: { ratingRequestedAt: new Date(), lastRatingAskAt: new Date(), ratingForId: conv.assignedToId || agent?.id || null, ratingForName: conv.assignedToName || agent?.name || "" } });
    return true;
  } catch (err) {
    console.error("[whatsapp] rating request failed:", err?.message); // eslint-disable-line no-console
    return false;
  }
};

module.exports = { ingest, preview, advances, findOrCreateConversation, sendOutbound, requestRating, ratingFrom, RATING_ASK };
