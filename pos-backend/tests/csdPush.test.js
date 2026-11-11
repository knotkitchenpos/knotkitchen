/**
 * CSD web push: new customer WhatsApp messages reach agents' devices.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const webpush = require("web-push");

const push = require("../services/csdPush");
const { CsdPushSubscription, WebPushKey } = require("../models/csdPushModel");
const CsdStaff = require("../models/csdStaffModel");

const KEYS = { p256dh: "B" + "a".repeat(86), auth: "x".repeat(22) };

test("only the browsers' push services are accepted as a device address", () => {
  for (const endpoint of [
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://web.push.apple.com/QGx",
    "https://updates.push.services.mozilla.com/wpush/v2/gAAA",
    "https://db5p.notify.windows.com/w/?token=x",
  ]) assert.equal(push.isValidSubscription({ endpoint, keys: KEYS }), true, endpoint);

  for (const endpoint of [
    "http://fcm.googleapis.com/fcm/send/abc", // not https
    "https://fcm.googleapis.com:8443/x", // another port
    "https://evil.example/fcm.googleapis.com", // look-alike path
    "https://fcm.googleapis.com.evil.example/x", // look-alike host
    "https://169.254.169.254/latest/meta-data", // the server's own network
    "https://localhost/x",
  ]) assert.equal(push.isValidSubscription({ endpoint, keys: KEYS }), false, endpoint);

  assert.equal(push.isValidSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: KEYS.auth } }), false);
  assert.equal(push.isValidSubscription(null), false);
});

test("a new WhatsApp message goes to every subscribed active agent; gone devices are removed", async () => {
  const saved = {
    send: webpush.sendNotification, key: WebPushKey.findById, staff: CsdStaff.find,
    subs: CsdPushSubscription.find, del: CsdPushSubscription.deleteMany, upd: CsdPushSubscription.updateMany,
  };
  const keys = webpush.generateVAPIDKeys();
  const a = new mongoose.Types.ObjectId();
  const sent = [];
  let deleted = null;
  push._reset();
  WebPushKey.findById = () => ({ lean: async () => ({ _id: "csd-vapid", ...keys }) });
  CsdStaff.find = () => ({ lean: async () => [{ _id: a }] });
  CsdPushSubscription.find = () => ({ lean: async () => [
    { _id: "s1", staffId: a, endpoint: "https://fcm.googleapis.com/fcm/send/one", keys: KEYS },
    { _id: "s2", staffId: a, endpoint: "https://fcm.googleapis.com/fcm/send/gone", keys: KEYS },
  ] });
  CsdPushSubscription.deleteMany = async (q) => { deleted = q; };
  CsdPushSubscription.updateMany = async () => {};
  webpush.sendNotification = async (sub, payload, opts) => {
    if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    sent.push({ sub, payload: JSON.parse(payload), opts });
  };
  try {
    const conv = { _id: new mongoose.Types.ObjectId(), waId: "919812345678", customName: "", profileName: "" };
    const r = await push.notifyWhatsApp(conv, { type: "image", body: "error screen" });
    assert.deepEqual([r.sent, r.removed], [1, 1]);
    assert.deepEqual(deleted, { _id: { $in: ["s2"] } }, "the device the push service says is gone is dropped");
    const p = sent[0].payload;
    assert.equal(p.title, "+919812345678", "no name yet: the number");
    assert.equal(p.body, "📷 Photo: error screen");
    assert.equal(p.url, `/chat?tab=whatsapp&c=${conv._id}`, "tapping it opens that chat");
    assert.equal(p.tag, `wa-${conv._id}`, "a newer message from the same customer replaces the alert");
    assert.equal(sent[0].opts.vapidDetails.publicKey, keys.publicKey);
    assert.equal(sent[0].opts.urgency, "high");

    // A push service failing never throws into the WhatsApp webhook.
    webpush.sendNotification = async () => { throw Object.assign(new Error("boom"), { statusCode: 500 }); };
    const quiet = console.error; console.error = () => {}; // eslint-disable-line no-console
    try {
      const r2 = await push.notifyWhatsApp({ ...conv, customName: "Asha Kitchen" }, { type: "text", body: "hello" });
      assert.equal(r2.sent, 0);
    } finally { console.error = quiet; } // eslint-disable-line no-console
  } finally {
    webpush.sendNotification = saved.send;
    WebPushKey.findById = saved.key;
    CsdStaff.find = saved.staff;
    CsdPushSubscription.find = saved.subs;
    CsdPushSubscription.deleteMany = saved.del;
    CsdPushSubscription.updateMany = saved.upd;
    push._reset();
  }
});

test("customer messages only go to staff who have the WhatsApp section", async () => {
  const saved = { send: webpush.sendNotification, key: WebPushKey.findById, staff: CsdStaff.find, subs: CsdPushSubscription.find, upd: CsdPushSubscription.updateMany };
  const keys = webpush.generateVAPIDKeys();
  const allowed = new mongoose.Types.ObjectId();
  const limited = new mongoose.Types.ObjectId();
  const admin = new mongoose.Types.ObjectId();
  let asked;
  push._reset();
  WebPushKey.findById = () => ({ lean: async () => ({ _id: "csd-vapid", ...keys }) });
  CsdStaff.find = () => ({ lean: async () => [
    { _id: allowed, role: "staff", permissions: ["whatsapp"] },
    { _id: limited, role: "staff", permissions: ["jobs"] },
    { _id: admin, role: "admin", permissions: [] },
  ] });
  CsdPushSubscription.find = (q) => { asked = q.staffId.$in.map(String); return { lean: async () => [] }; };
  try {
    await push.notifyWhatsApp({ _id: new mongoose.Types.ObjectId(), waId: "919812345678" }, { type: "text", body: "hi" });
    assert.deepEqual(asked.sort(), [String(allowed), String(admin)].sort());
  } finally {
    webpush.sendNotification = saved.send; WebPushKey.findById = saved.key; CsdStaff.find = saved.staff; CsdPushSubscription.find = saved.subs; CsdPushSubscription.updateMany = saved.upd;
    push._reset();
  }
});

test("the key pair is made once and reused (a new key would cut off every subscribed device)", async () => {
  const saved = { find: WebPushKey.findById, create: WebPushKey.create };
  let row = null;
  let creates = 0;
  push._reset();
  WebPushKey.findById = () => ({ lean: async () => row });
  WebPushKey.create = async (doc) => { creates += 1; row = doc; return doc; };
  try {
    const k1 = await push.getKeys();
    push._reset();
    const k2 = await push.getKeys();
    assert.equal(creates, 1);
    assert.equal(k1.publicKey, k2.publicKey);
    assert.match(k1.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  } finally {
    WebPushKey.findById = saved.find;
    WebPushKey.create = saved.create;
    push._reset();
  }
});
