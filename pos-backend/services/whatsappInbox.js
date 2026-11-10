const mongoose = require("mongoose");
const { WaConversation, WaMessage } = require("../models/waChatModel");

/**
 * Writes provider events (services/whatsapp.js parse*) into the inbox:
 * customer messages, messages sent from another app, and delivery receipts.
 *
 * Providers retry webhooks, so everything here is idempotent: a message is
 * keyed by the provider's message id (unique index), and a receipt only ever
 * moves a message's status forward.
 */

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

module.exports = { ingest, preview, advances, findOrCreateConversation };
