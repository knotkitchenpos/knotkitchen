/**
 * CSD: staff sections, Store Health, owner alerts, knowledge base, AI replies.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { hasSection, knownSections, sectionsForPath } = require("../constants/csdSections");
const { requireCsdSection } = require("../middlewares/csdAuth");
const { issuesFor } = require("../services/storeHealth");
const alerts = require("../services/storeAlerts");
const { StoreAlert } = require("../models/csdStoreAlertModel");
const { WaConversation, WaMessage } = require("../models/waChatModel");
const Article = require("../models/csdKnowledgeModel");
const kb = require("../controllers/csdKnowledgeController");
const wa = require("../services/whatsapp");
const ai = require("../services/aiReply");

const NOW = new Date("2026-11-12T06:00:00Z");
const DAY = 86400000;
const sales = { role: "staff", permissions: ["stores", "whatsapp", "chat", "jobs", "health", "knowledge"] };

const guard = (staff, path) => new Promise((resolve) => requireCsdSection({ csdStaff: staff, path }, {}, (err) => resolve(err || null)));

test("sections: admins have all, an unlimited staff member has all, a limited one only theirs", () => {
  assert.equal(hasSection({ role: "admin", permissions: ["jobs"] }, "billing"), true);
  assert.equal(hasSection({ role: "staff", permissions: [] }, "billing"), true, "existing staff lose nothing");
  assert.equal(hasSection(sales, "billing"), false);
  assert.equal(hasSection(sales, "whatsapp"), true);
  assert.equal(hasSection({ role: "staff", permissions: ["old-unknown-value"] }, "billing"), true, "junk in an old row locks nobody out");
  assert.deepEqual(knownSections(["jobs", "jobs", "nope"]), ["jobs"]);
});

test("the guard blocks a limited staff member by path, on every route under it", async () => {
  for (const path of ["/billing/config", "/billing/accounts/abc", "/hardware-requests", "/orders/search", "/knot-eats/stores", "/kkmdm/sso"]) {
    const err = await guard(sales, path);
    assert.equal(err?.status, 403, path);
    assert.equal(err.code, "SECTION_DENIED");
  }
  for (const path of ["/stores/search", "/restaurants/123456", "/whatsapp/conversations", "/jobs/1", "/health", "/knowledge", "/auth/me", "/push"]) {
    assert.equal(await guard(sales, path), null, path);
  }
  assert.equal(await guard({ role: "staff", permissions: ["whatsapp"] }, "/jobs/meta/assignees"), null, "the inbox's assign menu");
  assert.equal((await guard({ role: "staff", permissions: ["whatsapp"] }, "/jobs/1"))?.status, 403);
  assert.equal(await guard({ role: "staff", permissions: ["whatsapp"] }, "/knowledge/quick-replies"), null);
  assert.equal((await guard({ role: "staff", permissions: ["whatsapp"] }, "/knowledge"))?.status, 403);
  assert.deepEqual(sectionsForPath("/storesomething"), null, "matches whole path segments only");
});

const base = { store: { createdAt: new Date(NOW - 90 * DAY) }, lastOrderAt: new Date(NOW - DAY), balancePaise: 500000, sub: { status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + 20 * DAY), lastPaidPricePaise: 59900 }, devices: [], now: NOW };
const kinds = (x) => issuesFor({ ...base, ...x }).map((i) => `${i.kind}:${i.severity}`);

test("health: a healthy store has no issues", () => assert.deepEqual(kinds({}), []));

test("health: quiet stores", () => {
  assert.deepEqual(kinds({ lastOrderAt: new Date(NOW - 6 * DAY) }), []);
  assert.deepEqual(kinds({ lastOrderAt: new Date(NOW - 8 * DAY) }), ["no_orders:warning"]);
  assert.deepEqual(kinds({ lastOrderAt: new Date(NOW - 31 * DAY) }), ["no_orders:critical"]);
  assert.deepEqual(kinds({ lastOrderAt: null, store: { createdAt: new Date(NOW - 3 * DAY) } }), [], "a brand-new store has had no chance yet");
  assert.deepEqual(kinds({ lastOrderAt: null, store: { createdAt: new Date(NOW - 10 * DAY) } }), ["no_orders:warning"]);
});

test("health: wallet", () => {
  assert.deepEqual(kinds({ balancePaise: 15000 }), ["wallet_low:warning"]);
  assert.deepEqual(kinds({ balancePaise: 1000 }), ["wallet_low:critical"]);
  assert.deepEqual(kinds({ balancePaise: 1000, sub: { status: "CANCELLED" } }), [], "a store that left is not chased for its wallet");
});

test("health: only a renewal that will fail is a problem", () => {
  const ending = { status: "ACTIVE", currentPeriodEnd: new Date(NOW.getTime() + 5 * DAY), lastPaidPricePaise: 59900 };
  assert.deepEqual(kinds({ sub: ending }), [], "wallet covers it");
  assert.deepEqual(kinds({ sub: ending, balancePaise: 30000 }), ["subscription_ending:warning"]);
  assert.deepEqual(kinds({ sub: { ...ending, currentPeriodEnd: new Date(NOW.getTime() + DAY) }, balancePaise: 30000 }), ["subscription_ending:critical"]);
  assert.deepEqual(kinds({ sub: { status: "EXPIRED", currentPeriodEnd: new Date(NOW - DAY) } }), ["subscription_ending:critical"]);
});

test("health: tablets, with a grace period for closing time", () => {
  const seen = (h) => new Date(NOW.getTime() - h * 3600000);
  assert.deepEqual(kinds({ devices: [{ online: false, lastSeenAt: seen(5) }] }), [], "offline for 5 hours is not news");
  assert.deepEqual(kinds({ devices: [{ online: false, lastSeenAt: seen(20) }] }), ["device_offline:critical"]);
  assert.deepEqual(kinds({ devices: [{ online: false, lastSeenAt: seen(20) }, { online: true, lastSeenAt: seen(0) }] }), ["device_offline:warning"]);
  assert.deepEqual(kinds({ devices: [] }), []);
});

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const F2S = { WHATSAPP_PROVIDER: "fast2sms", FAST2SMS_API_KEY: "k", FAST2SMS_WA_PHONE_NUMBER_ID: "1", FAST2SMS_WEBHOOK_SECRET: "s" };
const store = { storeId: "123456", storeName: "Asha Kitchen", ownerName: "Asha", ownerPhone: "9876543210" };
const issue = { kind: "wallet_low", severity: "warning", balancePaise: 15000 };
const ready = { kinds: { wallet_low: { ready: true, tpl: { name: "kk_wallet_low", language: "en", body: "Hi {{1}}, {{2}} has {{3}}.", variables: ["1", "2", "3"], supported: true } } } };

const stubbed = async (fn) => {
  const saved = { fo: StoreAlert.findOne, del: StoreAlert.deleteOne, cr: StoreAlert.create, up: StoreAlert.updateOne, conv: WaConversation.findOneAndUpdate, cu: WaConversation.updateOne, mc: WaMessage.create, mu: WaMessage.updateOne, mf: WaMessage.findById, fetch: global.fetch };
  const log = { alerts: [], updates: [], messages: [], convUpdates: [], sent: [] };
  StoreAlert.findOne = () => ({ lean: async () => null });
  StoreAlert.deleteOne = async () => {};
  StoreAlert.create = async (d) => (log.alerts.push(d), { _id: "a1", ...d });
  StoreAlert.updateOne = async (_q, u) => log.updates.push(u.$set);
  const convId = new mongoose.Types.ObjectId();
  WaConversation.findOneAndUpdate = async () => ({ _id: convId, waId: "919876543210" });
  WaConversation.updateOne = async (_q, u) => log.convUpdates.push(u);
  WaMessage.create = async (d) => (log.messages.push(d), { ...d, _id: new mongoose.Types.ObjectId() });
  WaMessage.updateOne = async () => {};
  WaMessage.findById = () => ({ lean: async () => ({ _id: "m1" }) });
  global.fetch = async (url, init) => (log.sent.push({ url, body: JSON.parse(init.body) }), new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
  try { await withEnv(F2S, () => fn(log)); } finally {
    Object.assign(StoreAlert, { findOne: saved.fo, deleteOne: saved.del, create: saved.cr, updateOne: saved.up });
    Object.assign(WaConversation, { findOneAndUpdate: saved.conv, updateOne: saved.cu });
    Object.assign(WaMessage, { create: saved.mc, updateOne: saved.mu, findById: saved.mf });
    global.fetch = saved.fetch;
  }
};

test("alert: fills the approved template in order, lands in the chat, and does not claim it", () => stubbed(async (log) => {
  await alerts.sendAlert({ store, issue, templates: ready, now: NOW });
  assert.equal(log.sent[0].body.to, "919876543210");
  assert.deepEqual(log.sent[0].body.template.components[0].parameters.map((p) => p.text), ["Asha", "Asha Kitchen", "₹150"]);
  assert.equal(log.messages[0].staffName, "Automatic alert");
  assert.equal(log.messages[0].body, "Hi Asha, Asha Kitchen has ₹150.");
  assert.equal(log.updates.at(-1).status, "sent");
  const after = log.convUpdates.find((u) => u.$set?.lastMessagePreview);
  assert.equal(after.$set.assignedToId, undefined, "an alert is not an agent taking the chat");
  assert.equal(after.$set.unreadCount, undefined, "and does not mark the customer's messages read");
  assert.equal(log.convUpdates.at(-1).$set.status, "closed", "an owner who never wrote does not fill the Open queue");
}));

test("alert: refused without an approved template, during the cooldown, or if another send won", () => stubbed(async (log) => {
  await assert.rejects(alerts.sendAlert({ store, issue, templates: { kinds: { wallet_low: { ready: false } } }, now: NOW }), /not approved yet/);
  StoreAlert.findOne = () => ({ lean: async () => ({ sentAt: new Date(NOW - DAY) }) });
  await assert.rejects(alerts.sendAlert({ store, issue, templates: ready, now: NOW }), /already got this alert/);
  StoreAlert.findOne = () => ({ lean: async () => null });
  StoreAlert.create = async () => { throw Object.assign(new Error("dup"), { code: 11000 }); };
  await assert.rejects(alerts.sendAlert({ store, issue, templates: ready, now: NOW }), /already being sent/);
  assert.equal(log.sent.length, 0, "nothing was sent to the customer");
}));

test("alert: a provider failure is recorded, so it can be retried", () => stubbed(async (log) => {
  global.fetch = async () => new Response(JSON.stringify({ error: { message: "No balance" } }), { status: 400 });
  await assert.rejects(alerts.sendAlert({ store, issue, templates: ready, now: NOW }), /No balance/);
  assert.equal(log.updates.at(-1).status, "failed");
}));

test("automatic alerts are off until an admin turns them on", async () => {
  const { StoreAlertSettings } = require("../models/csdStoreAlertModel");
  const saved = StoreAlertSettings.findById;
  StoreAlertSettings.findById = () => ({ lean: async () => null });
  try { assert.deepEqual(await alerts.runAutoSweep(NOW), { sent: 0, skipped: "off" }); } finally { StoreAlertSettings.findById = saved; }
});

const res = () => { const r = { statusCode: 0 }; r.status = (c) => ((r.statusCode = c), r); r.json = (b) => ((r.body = b), r); return r; };
const staffReq = (body) => ({ body, params: {}, csdStaff: { _id: new mongoose.Types.ObjectId(), fullName: "Priya" } });

test("knowledge: validates, and normalises the shortcut", async () => {
  const saved = Article.create;
  let doc;
  Article.create = async (d) => { doc = d; return { ...d, _id: new mongoose.Types.ObjectId(), toObject() { return this; } }; };
  try {
    let err;
    await kb.createArticle(staffReq({ title: "x" }), res(), (e) => (err = e));
    assert.equal(err.status, 400);
    assert.ok(err.fieldErrors.title);
    err = undefined;
    await kb.createArticle(staffReq({ title: "Printer", body: "steps", shortcut: "bad shortcut!" }), res(), (e) => (err = e));
    assert.ok(err.fieldErrors.shortcut);
    err = undefined;
    await kb.createArticle(staffReq({ title: "Printer", body: "steps", shortcut: "printer" }), res(), (e) => (err = e));
    assert.ok(err.fieldErrors.quickReply, "a shortcut needs something to insert");
    const r = res();
    err = undefined;
    await kb.createArticle(staffReq({ title: "Printer", body: "steps", quickReply: "Restart it", shortcut: "/Printer-Fix" }), r, (e) => (err = e));
    assert.equal(err, undefined);
    assert.equal(r.statusCode, 201);
    assert.equal(doc.shortcut, "printer-fix");
    assert.equal(doc.createdByName, "Priya");
  } finally { Article.create = saved; }
});

test("AI: only customer and support messages reach the model, ending on the customer", () => {
  const m = (direction, body, extra = {}) => ({ direction, body, type: "text", status: "sent", ...extra });
  assert.deepEqual(ai.toTurns([
    m("out", "Earlier template we sent"),
    m("in", "Printer broken"),
    m("in", "Please help"),
    m("note", "SECRET internal note"),
    m("event", "Priya took this chat"),
    m("out", "Never delivered", { status: "failed" }),
    m("out", "Restart it"),
    m("in", "", { type: "image" }),
  ]), [
    { role: "user", content: "Printer broken\nPlease help" },
    { role: "assistant", content: "Restart it" },
    { role: "user", content: "[sent a photo]" },
  ]);
  assert.deepEqual(ai.toTurns([m("out", "Only us so far")]), []);
});

test("AI: drafts from the knowledge base; off without a key; a refusal says so", async () => {
  const saved = { find: Article.find, fetch: global.fetch };
  Article.find = () => ({ sort: () => ({ limit: () => ({ lean: async () => [{ title: "KOT printer", category: "Hardware", body: "Check paper.", quickReply: "Please restart it." }] }) }) });
  const messages = [{ direction: "in", type: "text", body: "Printer broken", status: "received" }];
  let sent;
  const reply = (over = {}) => async (url, init) => {
    sent = { url: String(url), body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "Please check the paper roll." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, ...over }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await withEnv({ ANTHROPIC_API_KEY: "" }, () => assert.rejects(ai.suggestReply({ messages }), /not switched on/));
    await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
      assert.equal(ai.isEnabled(), true);
      global.fetch = reply();
      ai._reset();
      const r = await ai.suggestReply({ messages, customerName: "Asha", storeNames: ["Asha Kitchen"] });
      assert.equal(r.text, "Please check the paper roll.");
      assert.match(sent.url, /\/v1\/messages/);
      assert.equal(sent.body.model, "claude-opus-5-5");
      assert.equal(sent.body.tools, undefined, "it can only write text");
      assert.equal(sent.body.fallbacks, "default");
      assert.match(sent.body.system[0].text, /Check paper\./);
      assert.deepEqual(sent.body.system[0].cache_control, { type: "ephemeral" });
      assert.match(sent.body.system[1].text, /Asha Kitchen/);
      assert.deepEqual(sent.body.messages, [{ role: "user", content: "Printer broken" }]);
      global.fetch = reply({ stop_reason: "refusal", content: [] });
      ai._reset(); // the SDK keeps the fetch it was built with
      await assert.rejects(ai.suggestReply({ messages }), /declined/);
      await assert.rejects(ai.suggestReply({ messages: [] }), /not written anything/);
    });
  } finally { Article.find = saved.find; global.fetch = saved.fetch; }
});

test("the WhatsApp provider's template list is what alerts are matched against", () => {
  assert.equal(typeof wa.listTemplates, "function");
  assert.deepEqual(Object.keys(alerts.KINDS).sort(), ["device_offline", "subscription_ending", "wallet_low"]);
  for (const def of Object.values(alerts.KINDS)) {
    const vars = def.wording.match(/\{\{\d+\}\}/g);
    assert.equal(def.values({}, {}).length, vars.length, def.template);
  }
});
