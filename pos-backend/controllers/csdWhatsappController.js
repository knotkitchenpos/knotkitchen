const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { WaConversation, WaMessage } = require("../models/waChatModel");
const CsdStaff = require("../models/csdStaffModel");
const Store = require("../models/storeModel");
const wa = require("../services/whatsapp");
const { ingest, sendOutbound } = require("../services/whatsappInbox");
const ai = require("../services/aiReply");

/**
 * CSD → Chat → WhatsApp: the team inbox for the support number.
 *
 * Every CSD member sees every conversation (like the internal chat): a
 * customer's history has to be there for whoever picks the chat up.
 * Assignment says who is handling it; it does not hide it from anyone.
 */

const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WINDOW_MS = 24 * 60 * 60 * 1000;

const me = (req) => ({ id: req.csdStaff._id, name: req.csdStaff.fullName || req.csdStaff.staffId || "CSD" });

const windowOpen = (conv) => !!conv.lastInboundAt && Date.now() - new Date(conv.lastInboundAt).getTime() < WINDOW_MS;

const providerFail = (err) => {
  if (err instanceof wa.ProviderError) {
    // Written to be read ("balance has run out"), so shown even as a 5xx.
    const e = createHttpError(err.status, err.message, { expose: true });
    e.code = err.code;
    return e;
  }
  return err;
};

const viewConversation = (c, myId) => ({
  id: String(c._id),
  waId: c.waId,
  phone: `+${c.waId}`,
  name: c.customName || c.profileName || "",
  profileName: c.profileName || "",
  customName: c.customName || "",
  status: c.status,
  assignedTo: c.assignedToId ? { id: String(c.assignedToId), name: c.assignedToName } : null,
  assignedToMe: !!c.assignedToId && String(c.assignedToId) === String(myId),
  lastMessageAt: c.lastMessageAt,
  lastMessagePreview: c.lastMessagePreview,
  lastMessageDirection: c.lastMessageDirection,
  unread: c.unreadCount || 0,
  windowOpen: windowOpen(c),
  windowClosesAt: c.lastInboundAt ? new Date(new Date(c.lastInboundAt).getTime() + WINDOW_MS) : null,
});

const viewMessage = (m, myId) => ({
  id: String(m._id),
  direction: m.direction,
  type: m.type,
  body: m.body,
  media: m.media?.url || m.media?.filename ? { hasFile: !!m.media.url, mimeType: m.media.mimeType, filename: m.media.filename } : null,
  template: m.template?.name ? { name: m.template.name } : null,
  status: m.status,
  error: m.error || "",
  staffName: m.staffName || "",
  isMine: !!m.staffId && String(m.staffId) === String(myId),
  external: !!m.external,
  at: m.sentAt || m.createdAt,
});

/** A line in the thread that says what happened (assigned, closed…). */
const logEvent = async (conv, text, req) =>
  WaMessage.create({ conversationId: conv._id, direction: "event", type: "event", body: text, staffId: me(req).id, staffName: me(req).name, status: "received" });

/* ----------------------------------------------------------------- status */

/** GET /api/csd/whatsapp/status — connected or not, and how to connect. */
const getStatus = async (req, res) => {
  const isAdmin = req.csdStaff?.role === "admin";
  res.status(200).json({
    success: true,
    data: {
      configured: wa.isConfigured(),
      provider: wa.providerName() || null,
      aiEnabled: ai.isEnabled(),
      // For the admin setting it up: where the provider must post events.
      ...(isAdmin ? {
        webhooks: {
          myoperator: "/api/whatsapp/webhook/myoperator/<WHATSAPP_WEBHOOK_TOKEN>",
          meta: "/api/whatsapp/webhook/meta",
          fast2sms: "/api/whatsapp/webhook/fast2sms",
        },
        // Fast2SMS: the body to paste into its WhatsApp webhook.
        fast2smsPayload: wa.FAST2SMS_WEBHOOK_PAYLOAD,
      } : {}),
    },
  });
};

/* ---------------------------------------------------------- conversations */

/** GET /api/csd/whatsapp/conversations?filter=all|mine|unassigned|unread|closed&q= */
const listConversations = async (req, res, next) => {
  try {
    const myId = me(req).id;
    const filter = str(req.query.filter) || "open";
    const base = {};
    if (filter === "closed") base.status = "closed";
    else if (filter !== "all") base.status = "open";
    if (filter === "mine") base.assignedToId = myId;
    if (filter === "unassigned") base.assignedToId = null;
    if (filter === "unread") base.unreadCount = { $gt: 0 };

    const q = str(req.query.q).slice(0, 80);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const d = q.replace(/\D/g, "");
      base.$or = [{ profileName: rx }, { customName: rx }, ...(d.length >= 3 ? [{ waId: new RegExp(escapeRegex(d)) }] : [])];
    }

    const [rows, counts] = await Promise.all([
      WaConversation.find(base).sort({ lastMessageAt: -1, createdAt: -1 }).limit(200).lean(),
      WaConversation.aggregate([
        { $match: { status: "open" } },
        {
          $group: {
            _id: null,
            open: { $sum: 1 },
            unread: { $sum: { $cond: [{ $gt: ["$unreadCount", 0] }, 1, 0] } },
            unassigned: { $sum: { $cond: [{ $eq: ["$assignedToId", null] }, 1, 0] } },
            mine: { $sum: { $cond: [{ $eq: ["$assignedToId", myId] }, 1, 0] } },
          },
        },
      ]),
    ]);

    res.status(200).json({
      success: true,
      data: {
        conversations: rows.map((c) => viewConversation(c, myId)),
        counts: { open: 0, unread: 0, unassigned: 0, mine: 0, ...(counts[0] || {}), _id: undefined },
        configured: wa.isConfigured(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/whatsapp/unread — for the badge on the nav. */
const unreadCount = async (req, res, next) => {
  try {
    const n = await WaConversation.countDocuments({ status: "open", unreadCount: { $gt: 0 } });
    res.status(200).json({ success: true, data: { unread: n } });
  } catch (error) {
    next(error);
  }
};

/** Restaurants whose owner phone is this number, so the agent knows who is writing. */
const storesFor = async (waId) => {
  if (!/^91\d{10}$/.test(waId)) return [];
  const rows = await Store.find({ ownerPhone: waId.slice(2), isDeleted: { $ne: true } }, { storeId: 1, storeName: 1 }).limit(5).lean();
  return rows.map((s) => ({ storeId: s.storeId, storeName: s.storeName }));
};

/**
 * GET /api/csd/whatsapp/conversations/:id/messages?before=<iso>&limit=
 * Newest page, oldest-first. Opening the conversation marks it read for the team.
 */
const listMessages = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));
    const conv = await WaConversation.findById(id).lean();
    if (!conv) return next(createHttpError(404, "Conversation not found."));

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 200);
    const filters = { conversationId: conv._id };
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && !Number.isNaN(before.getTime())) filters.sentAt = { $lt: before };

    const [page, stores] = await Promise.all([
      WaMessage.find(filters).sort({ sentAt: -1, _id: -1 }).limit(limit + 1).lean(),
      storesFor(conv.waId),
    ]);
    const hasMore = page.length > limit;

    if (conv.unreadCount > 0 && req.query.markRead !== "0") {
      await WaConversation.updateOne({ _id: conv._id }, { $set: { unreadCount: 0 } });
      conv.unreadCount = 0;
    }

    const myId = me(req).id;
    res.status(200).json({
      success: true,
      data: {
        conversation: { ...viewConversation(conv, myId), stores },
        messages: page.slice(0, limit).reverse().map((m) => viewMessage(m, myId)),
        hasMore,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** Approved template by name, as the provider has it (never trust the client's copy). */
const resolveTemplate = async (t) => {
  const name = str(t?.name);
  const language = str(t?.language);
  if (!name) throw createHttpError(400, "Pick a template.");
  const all = await wa.listTemplates();
  const tpl = all.find((x) => x.name === name && (!language || x.language === language));
  if (!tpl) throw createHttpError(400, "That template is not approved on the WhatsApp account.");
  if (!tpl.supported) throw createHttpError(400, "That template needs a picture or link CSD cannot fill in. Send it from the provider's panel.");
  const values = {};
  for (const v of tpl.variables) {
    const val = str(t?.values?.[v]).slice(0, 1000);
    if (!val) throw createHttpError(400, `Fill in {{${v}}} in the template.`);
    values[v] = val;
  }
  return { ...tpl, values };
};

/** Send as the signed-in agent; provider errors become readable HTTP errors. */
const sendOut = async (req, conv, { text, template }) => {
  try {
    return await sendOutbound({ conv, text, template, actor: me(req) });
  } catch (err) {
    throw providerFail(err);
  }
};

/**
 * POST /api/csd/whatsapp/conversations/:id/suggest
 * A draft reply from the knowledge base. It only fills the agent's text box.
 */
const suggestReply = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));
    const conv = await WaConversation.findById(id).lean();
    if (!conv) return next(createHttpError(404, "Conversation not found."));
    const [page, stores] = await Promise.all([
      WaMessage.find({ conversationId: conv._id, direction: { $in: ["in", "out"] } }).sort({ sentAt: -1, _id: -1 }).limit(40).lean(),
      storesFor(conv.waId),
    ]);
    const draft = await ai.suggestReply({
      messages: page.reverse(),
      customerName: conv.customName || conv.profileName || "",
      storeNames: stores.map((s) => s.storeName),
    });
    res.status(200).json({ success: true, data: draft });
  } catch (error) {
    if (error instanceof ai.AiError) return next(createHttpError(error.status, error.message, { expose: true }));
    next(error);
  }
};

/**
 * POST /api/csd/whatsapp/conversations/:id/messages
 *   { text }                         a reply (within 24 h of the customer's last message)
 *   { template: { name, language, values } }   an approved template, any time
 *   { note: true, text }             an internal note the customer never sees
 */
const postMessage = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));
    const conv = await WaConversation.findById(id).lean();
    if (!conv) return next(createHttpError(404, "Conversation not found."));
    const b = req.body || {};
    const mine = me(req);

    if (b.note === true) {
      const text = str(b.text);
      if (!text) return next(createHttpError(400, "Write the note first."));
      if (text.length > 4000) return next(createHttpError(400, "Note is too long (max 4000 characters)."));
      const note = await WaMessage.create({ conversationId: conv._id, direction: "note", type: "note", body: text, staffId: mine.id, staffName: mine.name, status: "received" });
      return res.status(201).json({ success: true, data: viewMessage(note.toObject(), mine.id) });
    }

    if (b.template) {
      const template = await resolveTemplate(b.template);
      const m = await sendOut(req, conv, { template });
      return res.status(201).json({ success: true, data: viewMessage(m, mine.id) });
    }

    const text = str(b.text);
    if (!text) return next(createHttpError(400, "Write a message first."));
    if (text.length > 4096) return next(createHttpError(400, "WhatsApp messages can be at most 4096 characters."));
    if (!windowOpen(conv)) {
      const e = createHttpError(409, "More than 24 hours have passed since the customer last wrote. WhatsApp only allows an approved template now.");
      e.code = "WHATSAPP_WINDOW_CLOSED";
      return next(e);
    }
    const m = await sendOut(req, conv, { text });
    res.status(201).json({ success: true, data: viewMessage(m, mine.id) });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/whatsapp/conversations { phone, name?, template }
 * Starts (or continues) a chat with a number. The first message to someone
 * who has not written in the last 24 h must be an approved template.
 */
const startConversation = async (req, res, next) => {
  try {
    const b = req.body || {};
    const waId = wa.normaliseWaId(b.phone);
    if (!waId) return next(createHttpError(400, "Enter a WhatsApp number: 10 digits, or + and the country code."));
    if (!wa.isConfigured()) {
      const e = createHttpError(503, "WhatsApp is not connected on this server yet.", { expose: true });
      e.code = "WHATSAPP_NOT_CONFIGURED";
      return next(e);
    }
    const template = await resolveTemplate(b.template);

    const name = str(b.name).slice(0, 200);
    let conv = await WaConversation.findOne({ waId }).lean();
    if (!conv) {
      try {
        conv = (await WaConversation.create({ waId, customName: name, status: "open" })).toObject();
      } catch (err) {
        if (err?.code !== 11000) throw err;
        conv = await WaConversation.findOne({ waId }).lean();
      }
    } else if (name && !conv.customName) {
      await WaConversation.updateOne({ _id: conv._id }, { $set: { customName: name } });
    }
    if (conv.status === "closed") await WaConversation.updateOne({ _id: conv._id }, { $set: { status: "open" } });

    const m = await sendOut(req, conv, { template });
    res.status(201).json({ success: true, data: { conversationId: String(conv._id), message: viewMessage(m, me(req).id) } });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/csd/whatsapp/conversations/:id
 *   { assignedTo: "<staff id>" | "me" | null }   hand over / take / release
 *   { status: "open" | "closed" }
 *   { customName: "…" }                            what the team calls this customer
 */
const updateConversation = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));
    const conv = await WaConversation.findById(id);
    if (!conv) return next(createHttpError(404, "Conversation not found."));
    const b = req.body || {};
    const mine = me(req);
    const events = [];

    if (Object.prototype.hasOwnProperty.call(b, "assignedTo")) {
      if (b.assignedTo === null || b.assignedTo === "") {
        if (conv.assignedToId) events.push(`${mine.name} unassigned ${conv.assignedToName || "the chat"}`);
        conv.assignedToId = null;
        conv.assignedToName = "";
        conv.assignedAt = null;
      } else {
        const target = b.assignedTo === "me" ? String(mine.id) : str(b.assignedTo);
        if (!mongoose.Types.ObjectId.isValid(target)) return next(createHttpError(400, "Pick someone to assign it to."));
        const staff = await CsdStaff.findOne({ _id: target, status: "active" }, { fullName: 1, staffId: 1 }).lean();
        if (!staff) return next(createHttpError(400, "That person is not an active CSD member."));
        if (String(conv.assignedToId) !== String(staff._id)) {
          const who = staff.fullName || staff.staffId;
          events.push(String(staff._id) === String(mine.id) ? `${mine.name} took this chat` : `${mine.name} assigned this chat to ${who}`);
          conv.assignedToId = staff._id;
          conv.assignedToName = who;
          conv.assignedAt = new Date();
        }
      }
    }

    if (b.status !== undefined) {
      if (!["open", "closed"].includes(b.status)) return next(createHttpError(400, "Status is open or closed."));
      if (conv.status !== b.status) {
        events.push(b.status === "closed" ? `${mine.name} closed this chat` : `${mine.name} re-opened this chat`);
        conv.status = b.status;
        if (b.status === "closed") conv.unreadCount = 0;
      }
    }

    if (b.customName !== undefined) conv.customName = str(b.customName).slice(0, 200);

    await conv.save();
    for (const text of events) await logEvent(conv, text, req);
    res.status(200).json({ success: true, data: viewConversation(conv.toObject(), mine.id) });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/whatsapp/templates — approved templates CSD can send. */
const listTemplates = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await wa.listTemplates() });
  } catch (error) {
    next(providerFail(error));
  }
};

/** GET /api/csd/whatsapp/messages/:id/media — a file the customer sent. */
const getMedia = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid message id."));
    const m = await WaMessage.findById(id, { media: 1 }).lean();
    const url = m?.media?.url || "";
    if (!url) return next(createHttpError(404, "No file on this message."));
    if (url.startsWith("meta:")) {
      const file = await wa.metaMedia(url.slice(5));
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cache-Control", "private, max-age=3600");
      return res.status(200).send(file.buffer);
    }
    if (/^https:\/\//i.test(url)) return res.redirect(302, url);
    return next(createHttpError(404, "No file on this message."));
  } catch (error) {
    next(providerFail(error));
  }
};

/* ---------------------------------------------------------------- webhooks */

/** POST /api/whatsapp/webhook/myoperator/:token */
const myoperatorWebhook = async (req, res) => {
  if (!wa.webhookTokenMatches(req.params.token)) return res.status(404).json({ success: false });
  try {
    await ingest(wa.parseMyOperator(req.body));
    res.status(200).json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[whatsapp] MyOperator webhook failed:", err?.message);
    res.status(500).json({ success: false }); // let the provider retry
  }
};

/**
 * POST /api/whatsapp/webhook/fast2sms — checked against the 40-character
 * secret the webhook carries as a header. Caddy drops header names with an
 * underscore, so it is x-webhook-secret; webhook_secret_key (Fast2SMS's own
 * signing name) is still read for a proxy that keeps it.
 */
const fast2smsWebhook = async (req, res) => {
  if (!wa.verifyFast2smsSecret(req.get("x-webhook-secret") || req.get("webhook_secret_key"))) return res.status(401).json({ success: false });
  try {
    await ingest(wa.parseFast2sms(req.body));
    res.status(200).json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[whatsapp] Fast2SMS webhook failed:", err?.message);
    res.status(500).json({ success: false }); // Fast2SMS retries up to 3 times
  }
};

/** GET /api/whatsapp/webhook/meta — Meta's subscribe handshake. */
const metaVerify = (req, res) => {
  const want = String(process.env.WHATSAPP_META_VERIFY_TOKEN || "");
  if (want && req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === want) {
    return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] || ""));
  }
  return res.status(403).end();
};

/** POST /api/whatsapp/webhook/meta — signed with the app secret. */
const metaWebhook = async (req, res) => {
  if (!wa.verifyMetaSignature(req.rawBody, req.get("x-hub-signature-256"))) return res.status(401).end();
  try {
    await ingest(wa.parseMeta(req.body));
    res.status(200).json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[whatsapp] Meta webhook failed:", err?.message);
    res.status(500).json({ success: false });
  }
};

module.exports = {
  getStatus,
  listConversations,
  unreadCount,
  listMessages,
  postMessage,
  startConversation,
  updateConversation,
  suggestReply,
  listTemplates,
  getMedia,
  myoperatorWebhook,
  fast2smsWebhook,
  metaVerify,
  metaWebhook,
};
