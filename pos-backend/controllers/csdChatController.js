const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { CsdConversation, CsdMessage } = require("../models/csdChatModel");
const Store = require("../models/storeModel");

const str = (v) => String(v ?? "").trim();
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const me = (req) => ({
  id: req.csdStaff._id,
  code: req.csdStaff.staffId,
  name: req.csdStaff.fullName,
});

/** Participant entry for a given staff member, if they're in the thread. */
const participantOf = (conv, staffId) =>
  (conv.participants || []).find((p) => String(p.staffId) === String(staffId));

/**
 * GET /api/csd/chat/conversations
 *
 * Lists every non-archived conversation with the caller's unread count.
 *
 * Conversations are visible to all CSD staff by design: this is an internal
 * support desk, not private messaging. Anyone picking up a ticket needs the
 * history, and the spec's store-linked threads only work if a colleague can
 * read what was already said about that restaurant.
 */
const listConversations = async (req, res, next) => {
  try {
    const filters = { archived: false };
    if (str(req.query.type)) filters.type = str(req.query.type);
    if (str(req.query.storeId)) filters.storeId = str(req.query.storeId);
    if (str(req.query.q)) {
      const rx = new RegExp(escapeRegex(str(req.query.q)), "i");
      filters.$or = [{ title: rx }, { restaurantName: rx }, { storeId: rx }];
    }

    const conversations = await CsdConversation.find(filters)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .limit(100)
      .lean();

    // One grouped count for every thread the caller has unread messages in,
    // rather than a query per conversation.
    const mine = me(req);
    const watermarks = new Map();
    for (const c of conversations) {
      const p = participantOf(c, mine.id);
      watermarks.set(String(c._id), p?.lastReadAt || new Date(0));
    }

    const unreadAgg = await CsdMessage.aggregate([
      {
        $match: {
          conversationId: { $in: conversations.map((c) => c._id) },
          authorId: { $ne: mine.id }, // your own messages are never "unread"
        },
      },
      { $group: { _id: { c: "$conversationId", at: "$createdAt" } } },
      { $group: { _id: "$_id.c", times: { $push: "$_id.at" } } },
    ]);

    const unreadById = new Map();
    for (const row of unreadAgg) {
      const since = watermarks.get(String(row._id)) || new Date(0);
      unreadById.set(String(row._id), row.times.filter((t) => t > since).length);
    }

    res.status(200).json({
      success: true,
      data: conversations.map((c) => ({
        id: String(c._id),
        title: c.title,
        type: c.type,
        storeId: c.storeId,
        restaurantName: c.restaurantName,
        participantCount: (c.participants || []).length,
        messageCount: c.messageCount,
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageBy: c.lastMessageBy,
        unread: unreadById.get(String(c._id)) || 0,
        createdByName: c.createdByName,
        createdAt: c.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/chat/conversations */
const createConversation = async (req, res, next) => {
  try {
    const b = req.body || {};
    const title = str(b.title);
    const type = str(b.type) || "group";

    if (title.length < 2) return next(createHttpError(400, "Give the conversation a title."));
    if (!["group", "store"].includes(type)) return next(createHttpError(400, "Unknown conversation type."));

    let storeId = "";
    let restaurantName = "";
    if (type === "store" || str(b.storeId)) {
      storeId = str(b.storeId);
      if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Link a store using its 6-digit ID."));
      const store = await Store.findOne({ storeId, isDeleted: { $ne: true } }).lean();
      if (!store) return next(createHttpError(400, "No store with that ID."));
      restaurantName = store.storeName || "";
    }

    const mine = me(req);
    const conv = await CsdConversation.create({
      title,
      type,
      storeId,
      restaurantName,
      createdById: mine.id,
      createdByName: mine.name,
      participants: [
        { staffId: mine.id, staffCode: mine.code, name: mine.name, lastReadAt: new Date() },
      ],
    });

    res.status(201).json({ success: true, data: { id: String(conv._id), title: conv.title } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/chat/conversations/:id/messages
 *
 * Returns the most recent page, oldest-first for rendering. Reading also
 * advances the caller's unread watermark.
 */
const listMessages = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));

    const conv = await CsdConversation.findById(id);
    if (!conv) return next(createHttpError(404, "Conversation not found."));

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const filters = { conversationId: conv._id };
    if (str(req.query.q)) filters.body = new RegExp(escapeRegex(str(req.query.q)), "i");

    const [total, page] = await Promise.all([
      CsdMessage.countDocuments(filters),
      CsdMessage.find(filters).sort({ createdAt: -1 }).limit(limit).lean(),
    ]);

    const mine = me(req);
    const previousWatermark = participantOf(conv, mine.id)?.lastReadAt || null;

    // Mark read, joining the thread on first open.
    const existing = participantOf(conv, mine.id);
    if (existing) existing.lastReadAt = new Date();
    else {
      conv.participants.push({
        staffId: mine.id, staffCode: mine.code, name: mine.name, lastReadAt: new Date(),
      });
    }
    await conv.save();

    res.status(200).json({
      success: true,
      data: {
        conversation: {
          id: String(conv._id),
          title: conv.title,
          type: conv.type,
          storeId: conv.storeId,
          restaurantName: conv.restaurantName,
          participants: conv.participants.map((p) => ({ staffCode: p.staffCode, name: p.name })),
        },
        // Oldest-first so the client renders top-to-bottom without reversing.
        messages: page.reverse().map((m) => ({
          id: String(m._id),
          body: m.body,
          authorStaffId: m.authorStaffId,
          authorName: m.authorName,
          isMine: String(m.authorId) === String(mine.id),
          internal: m.internal,
          createdAt: m.createdAt,
          // Lets the client draw a "new messages" divider at the point the
          // reader had previously got to.
          unreadForMe:
            !!previousWatermark &&
            m.createdAt > previousWatermark &&
            String(m.authorId) !== String(mine.id),
        })),
        total,
        hasMore: total > page.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/chat/conversations/:id/messages */
const postMessage = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) return next(createHttpError(400, "Invalid conversation id."));

    const body = str(req.body?.body);
    if (!body) return next(createHttpError(400, "Write something first."));
    if (body.length > 8000) return next(createHttpError(400, "Message is too long (max 8000 characters)."));

    const conv = await CsdConversation.findById(id);
    if (!conv) return next(createHttpError(404, "Conversation not found."));

    const mine = me(req);
    const message = await CsdMessage.create({
      conversationId: conv._id,
      body,
      authorId: mine.id,
      authorStaffId: mine.code,
      authorName: mine.name,
      internal: req.body?.internal === true,
    });

    conv.lastMessageAt = message.createdAt;
    conv.lastMessagePreview = body.slice(0, 140);
    conv.lastMessageBy = mine.name;
    conv.messageCount = (conv.messageCount || 0) + 1;

    // Sending is implicitly reading everything before it.
    const p = participantOf(conv, mine.id);
    if (p) p.lastReadAt = message.createdAt;
    else {
      conv.participants.push({
        staffId: mine.id, staffCode: mine.code, name: mine.name, lastReadAt: message.createdAt,
      });
    }
    await conv.save();

    res.status(201).json({
      success: true,
      data: {
        id: String(message._id),
        body: message.body,
        authorStaffId: message.authorStaffId,
        authorName: message.authorName,
        isMine: true,
        internal: message.internal,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/csd/chat/search?q= — across every conversation. */
const searchMessages = async (req, res, next) => {
  try {
    const q = str(req.query.q);
    if (q.length < 2) return next(createHttpError(400, "Enter at least 2 characters."));

    const messages = await CsdMessage.find({ body: new RegExp(escapeRegex(q), "i") })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const convIds = [...new Set(messages.map((m) => String(m.conversationId)))];
    const convs = await CsdConversation.find({ _id: { $in: convIds } }, { title: 1, storeId: 1 }).lean();
    const byId = new Map(convs.map((c) => [String(c._id), c]));

    res.status(200).json({
      success: true,
      data: messages.map((m) => ({
        id: String(m._id),
        conversationId: String(m.conversationId),
        conversationTitle: byId.get(String(m.conversationId))?.title || "",
        storeId: byId.get(String(m.conversationId))?.storeId || "",
        body: m.body,
        authorName: m.authorName,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { listConversations, createConversation, listMessages, postMessage, searchMessages };
