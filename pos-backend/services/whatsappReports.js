const { WaConversation, WaMessage, WaRating } = require("../models/waChatModel");

/**
 * WhatsApp support numbers for Reports. Read-only.
 *
 * A "first response" is the wait from a customer's message, when nobody was
 * already due to answer, to the next reply an agent sent from CSD. Automatic
 * messages (alerts, rating requests) and replies from other apps do not count.
 */

const IST_MS = 5.5 * 3600 * 1000;
const MAX_MESSAGES = 100000;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

/** From messages sorted by conversation then time. Pure, so it can be tested. */
const summarise = (messages) => {
  const hours = Array(24).fill(0);
  const agents = new Map();
  const waits = [];
  const customers = new Set();
  let inbound = 0;
  let outbound = 0;
  let conv = null;
  let waitingSince = null;

  for (const m of messages) {
    const id = String(m.conversationId);
    if (id !== conv) { conv = id; waitingSince = null; }
    const at = new Date(m.sentAt).getTime();
    if (m.direction === "in") {
      inbound += 1;
      customers.add(id);
      hours[new Date(at + IST_MS).getUTCHours()] += 1;
      if (waitingSince === null) waitingSince = at;
      continue;
    }
    if (m.direction !== "out" || m.status === "failed") continue;
    outbound += 1;
    if (!m.staffId || m.external) continue;
    const key = String(m.staffId);
    if (!agents.has(key)) agents.set(key, { id: key, name: m.staffName || "", chats: new Set(), replies: 0, waits: [] });
    const a = agents.get(key);
    a.chats.add(id);
    a.replies += 1;
    if (waitingSince !== null) {
      const wait = Math.max(0, at - waitingSince);
      waits.push(wait);
      a.waits.push(wait);
      waitingSince = null;
    }
  }

  return {
    chats: customers.size,
    inbound,
    outbound,
    medianFirstResponseMs: median(waits),
    answeredWithin15Min: waits.length ? Math.round((waits.filter((w) => w <= 15 * 60000).length / waits.length) * 100) : null,
    responses: waits.length,
    busiestHours: hours,
    agents: [...agents.values()]
      .map((a) => ({ id: a.id, name: a.name, chats: a.chats.size, replies: a.replies, medianFirstResponseMs: median(a.waits) }))
      .sort((x, y) => y.chats - x.chats),
  };
};

const whatsappReport = async ({ from, to }) => {
  const [messages, unanswered, oldest, ratings] = await Promise.all([
    WaMessage.find({ sentAt: { $gte: from, $lt: to }, direction: { $in: ["in", "out"] } }, { conversationId: 1, direction: 1, sentAt: 1, staffId: 1, staffName: 1, external: 1, status: 1 })
      .sort({ conversationId: 1, sentAt: 1 }).limit(MAX_MESSAGES).lean(),
    WaConversation.countDocuments({ status: "open", lastMessageDirection: "in" }),
    WaConversation.findOne({ status: "open", lastMessageDirection: "in" }, { lastMessageAt: 1 }).sort({ lastMessageAt: 1 }).lean(),
    WaRating.find({ at: { $gte: from, $lt: to } }, { score: 1, agentId: 1 }).lean(),
  ]);

  const summary = summarise(messages);
  const byAgent = new Map();
  for (const r of ratings) {
    if (!r.agentId) continue;
    const k = String(r.agentId);
    if (!byAgent.has(k)) byAgent.set(k, []);
    byAgent.get(k).push(r.score);
  }
  const distribution = [1, 2, 3, 4, 5].map((score) => ({ score, count: ratings.filter((r) => r.score === score).length }));

  return {
    ...summary,
    agents: summary.agents.map((a) => ({ ...a, rating: round1(avg(byAgent.get(a.id) || [])), ratings: (byAgent.get(a.id) || []).length })),
    unanswered,
    oldestUnansweredAt: oldest?.lastMessageAt || null,
    ratings: { count: ratings.length, average: round1(avg(ratings.map((r) => r.score))), distribution },
    truncated: messages.length === MAX_MESSAGES,
  };
};

module.exports = { whatsappReport, summarise, median };
