/**
 * Send one approved WhatsApp template to a customer (owner, 2026-11-17: the
 * waitlist's "table ready" and loyalty's points balance).
 *
 * WhatsApp only lets a business start a chat with an approved template, so a
 * message here goes out only once its template is approved with exactly the
 * expected number of text variables; until then `ready` is false with the
 * reason, and callers show the information on screen instead. Sent through
 * the CSD inbox like the other templates, so it is on record.
 */

const cache = new Map(); // name -> { at, value }
const TTL_MS = 10 * 60 * 1000;

/** Is `name` approved with exactly `variables` text variables? Cached 10 minutes. */
const templateReady = async (name, variables) => {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const wa = require("./whatsapp");
  let value;
  if (!wa.isConfigured()) value = { ready: false, reason: "WhatsApp is not connected yet." };
  else {
    try {
      const tpl = (await wa.listTemplates()).find((t) => t.name === name);
      if (!tpl) value = { ready: false, reason: `The WhatsApp message "${name}" is not approved yet.` };
      else if (!tpl.supported || tpl.variables.length !== variables) value = { ready: false, reason: `The WhatsApp message "${name}" does not match (it needs ${variables} text variables).` };
      else value = { ready: true, tpl };
    } catch (err) {
      value = { ready: false, reason: `Could not check WhatsApp messages: ${err.message}` };
    }
  }
  cache.set(name, { at: Date.now(), value });
  return value;
};

// Template variables may not hold new lines, tabs or more than four spaces in a row, or be empty.
const flat = (s, n = 60) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || "-";

/**
 * Send `name` with `values` to a 10-digit Indian phone. Returns { sent: true }
 * or { sent: false, reason } -- never throws for "not approved yet".
 */
const sendTemplate = async ({ name, values, phone, actorName = "KnotKitchen" }) => {
  const wa = require("./whatsapp");
  const digits = String(phone || "").replace(/\D/g, "").slice(-10);
  const waId = wa.normaliseWaId(digits.length === 10 ? `91${digits}` : digits);
  if (!waId) return { sent: false, reason: "No valid WhatsApp number." };
  const status = await templateReady(name, values.length);
  if (!status.ready) return { sent: false, reason: status.reason };
  const { findOrCreateConversation, sendOutbound } = require("./whatsappInbox");
  const { WaConversation } = require("../models/waChatModel");
  const conv = await findOrCreateConversation({ waId, profileName: "" });
  const numbered = Object.fromEntries(values.map((v, i) => [String(i + 1), flat(v)]));
  await sendOutbound({ conv: conv.toObject ? conv.toObject() : conv, template: { ...status.tpl, values: numbered }, actor: { id: null, name: actorName }, claim: false });
  // A customer who never wrote is not a chat for agents to work: filed closed; a reply re-opens it.
  if (!conv.lastInboundAt && !conv.assignedToId) await WaConversation.updateOne({ _id: conv._id }, { $set: { status: "closed" } });
  return { sent: true };
};

module.exports = { templateReady, sendTemplate, flat, _clear: () => cache.clear() };
