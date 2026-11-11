/**
 * WhatsApp inbox extras: sending files, ratings, jobs from chats, reports.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const wa = require("../services/whatsapp");
const inbox = require("../services/whatsappInbox");
const { summarise, median } = require("../services/whatsappReports");
const { WaConversation, WaMessage, WaRating } = require("../models/waChatModel");
const ctl = require("../controllers/csdWhatsappController");

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const F2S = { WHATSAPP_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k", FAST2SMS_WA_PHONE_NUMBER_ID: "555", FAST2SMS_WEBHOOK_SECRET: "s" };

test("a file is uploaded to WhatsApp, then sent by its id: never at a public link", async () => {
  const saved = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(String(url).endsWith("/media") ? { id: "9001" } : { messages: [{ id: "wamid.f" }] }), { status: 200 });
  };
  try {
    await withEnv(F2S, async () => {
      const r = await wa.send({ waId: "919876543210", media: { buffer: Buffer.from("%PDF-1.4"), mimeType: "application/pdf", filename: "invoice.pdf", kind: "document", caption: "Your invoice" } });
      assert.equal(r.providerMessageId, "wamid.f");
      assert.match(calls[0].url, /\/555\/media$/);
      assert.equal(calls[0].init.headers.Authorization, "k");
      assert.equal(calls[0].init.body.get("type"), "application/pdf");
      assert.equal(calls[0].init.body.get("messaging_product"), "whatsapp");
      const body = JSON.parse(calls[1].init.body);
      assert.deepEqual(body.document, { id: "9001", caption: "Your invoice", filename: "invoice.pdf" });
      assert.equal(body.type, "document");
      assert.equal(JSON.stringify(body).includes("link"), false);

      await wa.send({ waId: "919876543210", media: { buffer: Buffer.from("x"), mimeType: "image/png", filename: "a.png", kind: "image" } });
      assert.deepEqual(JSON.parse(calls[3].init.body).image, { id: "9001" }, "a picture has no filename field");
    });
  } finally { global.fetch = saved; }
});

test("a file WhatsApp refuses reports why", async () => {
  const saved = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ error: { message: "File too large" } }), { status: 400 });
  try {
    await withEnv(F2S, () => assert.rejects(wa.send({ waId: "919876543210", media: { buffer: Buffer.from("x"), mimeType: "image/png", kind: "image" } }), /File too large/));
  } finally { global.fetch = saved; }
});

const res = () => { const r = { statusCode: 0 }; r.status = (c) => ((r.statusCode = c), r); r.json = (b) => ((r.body = b), r); return r; };

test("the upload route refuses a file that is not really a JPEG, PNG or PDF, and outside the window", async () => {
  const { Readable } = require("node:stream");
  const saved = WaConversation.findById;
  const conv = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", lastInboundAt: new Date() };
  WaConversation.findById = () => ({ lean: async () => conv });
  const req = (bytes) => Object.assign(Readable.from([bytes]), { params: { id: String(conv._id) }, query: { filename: "a.pdf" }, csdStaff: { _id: new mongoose.Types.ObjectId(), fullName: "Priya" } });
  try {
    let err;
    await ctl.postMedia(req(Buffer.from("<html><script>alert(1)</script></html>")), res(), (e) => (err = e));
    assert.equal(err.status, 400, "named .pdf, but its bytes say otherwise");
    assert.match(err.message, /JPEG, PNG or PDF/);
    conv.lastInboundAt = new Date(Date.now() - 25 * 3600000);
    err = undefined;
    await ctl.postMedia(req(Buffer.from("%PDF-1.4 aaaaaaaa")), res(), (e) => (err = e));
    assert.equal(err.code, "WHATSAPP_WINDOW_CLOSED");
  } finally { WaConversation.findById = saved; }
});

test("what counts as a rating", () => {
  for (const [t, n] of [["5", 5], [" 1 ", 1], ["४", 4], ["৩", 3], ["5️⃣", 5], ["3⭐", 3]]) assert.equal(inbox.ratingFrom(t), n, t);
  for (const t of ["6", "0", "5 stars please fix", "my table 3 is broken", "", "12"]) assert.equal(inbox.ratingFrom(t), null, t);
});

const ratingStubs = async (fn) => {
  const saved = { exists: WaMessage.exists, mc: WaMessage.create, mu: WaMessage.updateOne, mf: WaMessage.findById, cf: WaConversation.findOneAndUpdate, cu: WaConversation.updateOne, rc: WaRating.create, fetch: global.fetch };
  const log = { conv: [], ratings: [], sent: [], messages: [] };
  WaMessage.exists = async () => null;
  WaMessage.create = async (d) => (log.messages.push(d), { ...d, _id: new mongoose.Types.ObjectId() });
  WaMessage.updateOne = async () => {};
  WaMessage.findById = () => ({ lean: async () => ({}) });
  WaConversation.updateOne = async (_q, u) => log.conv.push(u);
  WaRating.create = async (d) => log.ratings.push(d);
  global.fetch = async (_u, init) => (log.sent.push(JSON.parse(init.body)), new Response(JSON.stringify({ messages: [{ id: "w" }] }), { status: 200 }));
  try { await withEnv(F2S, () => fn(log)); } finally {
    Object.assign(WaMessage, { exists: saved.exists, create: saved.mc, updateOne: saved.mu, findById: saved.mf });
    Object.assign(WaConversation, { findOneAndUpdate: saved.cf, updateOne: saved.cu });
    WaRating.create = saved.rc;
    global.fetch = saved.fetch;
  }
};

test("a 1-5 reply answers the rating and does not re-open the chat or alert anyone", () => ratingStubs(async (log) => {
  const agent = new mongoose.Types.ObjectId();
  const conv = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", status: "closed", ratingRequestedAt: new Date(), ratingForId: agent, ratingForName: "Priya" };
  WaConversation.findOneAndUpdate = async () => conv;
  await inbox.ingest([{ kind: "message", direction: "in", waId: conv.waId, providerMessageId: "r1", type: "text", body: "4", at: new Date() }]);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([log.ratings[0].score, log.ratings[0].agentName], [4, "Priya"]);
  const upd = log.conv[0];
  assert.equal(upd.$set.ratingRequestedAt, null);
  assert.equal(upd.$set.status, undefined, "stays closed");
  assert.equal(upd.$inc, undefined, "no unread");
}));

test("a real message after the rating request re-opens the chat as usual", () => ratingStubs(async (log) => {
  const conv = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", status: "closed", ratingRequestedAt: new Date() };
  WaConversation.findOneAndUpdate = async () => conv;
  await inbox.ingest([{ kind: "message", direction: "in", waId: conv.waId, providerMessageId: "r2", type: "text", body: "Still not working", at: new Date() }]);
  assert.equal(log.ratings.length, 0);
  assert.equal(log.conv[0].$set.status, "open");
  assert.equal(log.conv[0].$inc.unreadCount, 1);
}));

test("a number sent long after the request is just a message", () => ratingStubs(async (log) => {
  const conv = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", status: "closed", ratingRequestedAt: new Date(Date.now() - 30 * 3600000) };
  WaConversation.findOneAndUpdate = async () => conv;
  await inbox.ingest([{ kind: "message", direction: "in", waId: conv.waId, providerMessageId: "r3", type: "text", body: "3", at: new Date() }]);
  assert.equal(log.ratings.length, 0);
  assert.equal(log.conv[0].$set.status, "open");
}));

test("a rating is only asked for when an agent answered, inside 24 hours, once a week", () => ratingStubs(async (log) => {
  const base = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", lastInboundAt: new Date(Date.now() - 3600000), assignedToId: new mongoose.Types.ObjectId(), assignedToName: "Rahul" };
  assert.equal(await inbox.requestRating(base, { id: null, name: "x" }), false, "nobody answered");
  assert.equal(log.sent.length, 0);
  WaMessage.exists = async () => ({ _id: 1 });
  assert.equal(await inbox.requestRating({ ...base, lastInboundAt: new Date(Date.now() - 25 * 3600000) }, {}), false, "outside the window");
  assert.equal(await inbox.requestRating({ ...base, lastRatingAskAt: new Date(Date.now() - 3 * 86400000) }, {}), false, "asked this week");
  assert.equal(await inbox.requestRating({ ...base, lastInboundAt: null }, {}), false, "the customer never wrote");
  assert.equal(log.sent.length, 0);
  assert.equal(await inbox.requestRating(base, { id: "me", name: "Priya" }), true);
  assert.equal(log.sent[0].text.body, inbox.RATING_ASK);
  assert.equal(log.messages[0].staffId, null, "an automatic message is not an agent's reply");
  const set = log.conv.at(-1).$set;
  assert.equal(set.ratingForName, "Rahul", "credited to whoever had the chat");
  assert.ok(set.ratingRequestedAt);
}));

test("a job's transcript names who said what, includes files and notes, and stays within size", () => {
  const conv = { waId: "919876543210", customName: "Asha" };
  const at = new Date("2026-11-12T06:30:00Z");
  const text = ctl.transcript(conv, [
    { direction: "in", body: "Printer dead", sentAt: at, type: "text" },
    { direction: "out", body: "", staffName: "Priya", sentAt: at, type: "document", media: { url: "local:x", filename: "guide.pdf" } },
    { direction: "note", body: "Needs replacement", staffName: "Priya", sentAt: at, type: "note" },
    { direction: "event", body: "Priya took this chat", sentAt: at, type: "event" },
  ]);
  assert.match(text, /^From WhatsApp: Asha \(\+919876543210\)/);
  assert.match(text, /Asha: Printer dead/);
  assert.match(text, /Priya: \[document: guide\.pdf\]/);
  assert.match(text, /Priya \(internal note\): Needs replacement/);
  assert.doesNotMatch(text, /took this chat/);
  const long = ctl.transcript(conv, Array.from({ length: 400 }, (_, i) => ({ direction: "in", body: `message number ${i} with some length to it`, sentAt: at, type: "text" })));
  assert.ok(long.length <= 7801);
  assert.match(long, /message number 399/, "the newest part is the part kept");
});

test("reports: first response, per agent, busiest hour", () => {
  const conv = "c1";
  const t = (min) => new Date(Date.UTC(2026, 10, 12, 4, 30) + min * 60000); // 10:00 IST
  const summary = summarise([
    { conversationId: conv, direction: "in", sentAt: t(0) },
    { conversationId: conv, direction: "in", sentAt: t(1) }, // already waiting: the clock started at the first
    { conversationId: conv, direction: "out", sentAt: t(10), staffId: "a", staffName: "Priya", status: "sent" },
    { conversationId: conv, direction: "out", sentAt: t(11), staffId: "a", staffName: "Priya", status: "sent" }, // a follow-up is not a first response
    { conversationId: conv, direction: "in", sentAt: t(60) },
    { conversationId: conv, direction: "out", sentAt: t(61), staffId: null, staffName: "Automatic message", status: "sent" }, // not an agent
    { conversationId: conv, direction: "out", sentAt: t(62), staffId: "b", staffName: "Rahul", status: "failed" }, // never delivered
    { conversationId: conv, direction: "out", sentAt: t(90), staffId: "b", staffName: "Rahul", status: "read" },
    { conversationId: "c2", direction: "in", sentAt: t(200) }, // never answered
  ]);
  assert.equal(summary.chats, 2);
  assert.equal(summary.inbound, 4);
  assert.equal(summary.responses, 2);
  assert.equal(summary.medianFirstResponseMs, (10 + 30) / 2 * 60000);
  assert.equal(summary.answeredWithin15Min, 50);
  assert.equal(summary.busiestHours[10], 2, "India time");
  assert.deepEqual(summary.agents.map((a) => [a.name, a.chats, a.replies]), [["Priya", 1, 2], ["Rahul", 1, 1]]);
  assert.equal(median([]), null);
});
