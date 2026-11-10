/**
 * CSD WhatsApp inbox: provider webhooks in, messages out, the 24-hour rule.
 * Payload shapes are MyOperator's published webhook examples and Meta's
 * WhatsApp Cloud API format.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const mongoose = require("mongoose");

const wa = require("../services/whatsapp");
const { advances, preview } = require("../services/whatsappInbox");
const { WaConversation, WaMessage } = require("../models/waChatModel");
const ctl = require("../controllers/csdWhatsappController");

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

const MYOP = {
  WHATSAPP_PROVIDER: "myoperator",
  MYOPERATOR_API_KEY: "key-123",
  MYOPERATOR_COMPANY_ID: "comp-1",
  MYOPERATOR_PHONE_NUMBER_ID: "1196177000238423",
  WHATSAPP_WEBHOOK_TOKEN: "t".repeat(32),
};

const received = {
  company_id: "69ddcadb46536124",
  event_type: "message.received",
  timestamp: "2026-04-20T10:06:07.835252916Z",
  channel: "whatsapp",
  direction: "incoming",
  session_id: "e8e99f13-f41e-4655-b393-09e03cb5f91c",
  customer_identifier: "917779812955",
  payload: {
    id: "1975ec0a-67fe-4a37-af4b-4ed7449862ab",
    action: "incoming",
    status: "received",
    data: { type: "text", context: { body: "Offer" } },
    metadata: { waba_msg_id: "wamid.X", myop_ref_id: null, errors: null },
    created: "2026-04-20T10:06:07.617308Z",
    conversation: { id: "e8e99f13-f41e-4655-b393-09e03cb5f91c", customer_country_code: "91", customer_contact: "7779812955", customer_name: "Suraj Singh" },
    phone_number_id: "1196177000238423",
  },
};

test("MyOperator message.received becomes a customer message with name and number", () => {
  const [e] = wa.parseMyOperator(received);
  assert.equal(e.kind, "message");
  assert.equal(e.direction, "in");
  assert.equal(e.waId, "917779812955");
  assert.equal(e.profileName, "Suraj Singh");
  assert.equal(e.body, "Offer");
  assert.equal(e.providerMessageId, "1975ec0a-67fe-4a37-af4b-4ed7449862ab");
  assert.equal(e.at.toISOString(), "2026-04-20T10:06:07.617Z");
});

test("MyOperator: a name that is just the number is not kept as a name", () => {
  const body = structuredClone(received);
  body.payload.conversation.customer_name = "917779812955";
  assert.equal(wa.parseMyOperator(body)[0].profileName, "");
});

test("MyOperator: a reply sent from another app is added to the history; our own comes back as a receipt", () => {
  const sent = structuredClone(received);
  sent.event_type = "message.sent";
  sent.payload.action = "outgoing";
  sent.payload.id = "out-1";
  sent.payload.metadata.myop_ref_id = "ref-9";
  const events = wa.parseMyOperator(sent);
  assert.deepEqual(events.map((e) => e.kind), ["message", "status"]);
  assert.equal(events[0].direction, "out");
  assert.equal(events[0].external, true);
  assert.equal(events[0].refId, "ref-9", "carries the ref so the inbox can tell it is ours");
  assert.equal(events[1].status, "sent");
});

test("MyOperator failed receipts carry WhatsApp's reason; the deprecated format still works", () => {
  const failed = structuredClone(received);
  failed.event_type = "message.failed";
  failed.payload.metadata.errors = { 130472: "Failed to send message because this user's phone number is part of an experiment" };
  const [e] = wa.parseMyOperator(failed);
  assert.equal(e.kind, "status");
  assert.equal(e.status, "failed");
  assert.match(e.error, /part of an experiment \(130472\)/);

  const old = { type: "message", event: "delivered", data: { id: "m-1", action: "outgoing", status: "sent", data: { type: "text", context: { body: "x" } }, metadata: {}, conversation: { customer_country_code: "91", customer_contact: "7900766070" } } };
  const [d] = wa.parseMyOperator(old);
  assert.equal(d.kind, "status");
  assert.equal(d.status, "delivered");
  assert.equal(d.providerMessageId, "m-1");
});

test("MyOperator: media keeps only https links; other channels and junk are ignored", () => {
  const img = structuredClone(received);
  img.payload.data = { type: "image", context: { link: "https://cdn.example/a.jpg", caption: "bill", mime_type: "image/jpeg" } };
  const [e] = wa.parseMyOperator(img);
  assert.equal(e.media.url, "https://cdn.example/a.jpg");
  assert.equal(e.body, "bill");
  img.payload.data.context.link = "javascript:alert(1)";
  assert.equal(wa.parseMyOperator(img)[0].media.url, "");
  assert.deepEqual(wa.parseMyOperator({ ...received, channel: "sms" }), []);
  assert.deepEqual(wa.parseMyOperator(null), []);
  assert.deepEqual(wa.parseMyOperator({ event_type: "call.end", payload: {} }), []);
});

test("Meta Cloud API webhooks: messages with profile names, and receipts", () => {
  const body = {
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: {
      metadata: { phone_number_id: "555" },
      contacts: [{ wa_id: "919876543210", profile: { name: "Asha" } }],
      messages: [
        { from: "919876543210", id: "wamid.1", timestamp: "1767225600", type: "text", text: { body: "Printer not working" } },
        { from: "919876543210", id: "wamid.2", timestamp: "1767225601", type: "image", image: { id: "777", mime_type: "image/jpeg", caption: "see" } },
      ],
      statuses: [{ id: "wamid.out", status: "failed", timestamp: "1767225602", errors: [{ code: 131047, message: "Re-engagement message" }] }],
    } }] }],
  };
  const events = wa.parseMeta(body);
  assert.equal(events.length, 3);
  assert.equal(events[0].profileName, "Asha");
  assert.equal(events[0].body, "Printer not working");
  assert.equal(events[0].at.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.equal(events[1].media.url, "meta:777");
  assert.equal(events[2].status, "failed");
  assert.match(events[2].error, /131047/);
  assert.deepEqual(wa.parseMeta({ object: "page" }), []);
});

test("Meta webhook signature is checked over the raw body", async () => {
  await withEnv({ WHATSAPP_META_APP_SECRET: "app-secret" }, () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account"}');
    const good = `sha256=${crypto.createHmac("sha256", "app-secret").update(raw).digest("hex")}`;
    assert.equal(wa.verifyMetaSignature(raw, good), true);
    assert.equal(wa.verifyMetaSignature(raw, good.replace(/.$/, "0")), false);
    assert.equal(wa.verifyMetaSignature(raw, undefined), false);
  });
});

test("the MyOperator webhook URL token must match, and a short token is never accepted", async () => {
  await withEnv({ WHATSAPP_WEBHOOK_TOKEN: "s".repeat(32) }, () => {
    assert.equal(wa.webhookTokenMatches("s".repeat(32)), true);
    assert.equal(wa.webhookTokenMatches("s".repeat(31)), false);
    assert.equal(wa.webhookTokenMatches(""), false);
  });
  await withEnv({ WHATSAPP_WEBHOOK_TOKEN: "short" }, () => assert.equal(wa.webhookTokenMatches("short"), false));
});

test("numbers typed by an agent become WhatsApp ids", () => {
  assert.equal(wa.normaliseWaId("98765 43210"), "919876543210");
  assert.equal(wa.normaliseWaId("+91 98765-43210"), "919876543210");
  assert.equal(wa.normaliseWaId("09876543210"), "919876543210");
  assert.equal(wa.normaliseWaId("+44 7911 123456"), "447911123456");
  assert.equal(wa.normaliseWaId("12345"), "");
  assert.deepEqual(wa.splitWaId("919876543210"), { cc: "91", number: "9876543210" });
  assert.deepEqual(wa.splitWaId("447911123456"), { cc: "44", number: "7911123456" });
});

test("sending through MyOperator: the request it documents, and its errors in plain words", async () => {
  const savedFetch = global.fetch;
  const calls = [];
  try {
    await withEnv(MYOP, async () => {
      global.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ status: "success", code: "200", data: { message_id: "mo-1", conversaton_id: "c-1" } }), { status: 200 });
      };
      const r = await wa.send({ waId: "919876543210", refId: "abc", text: "Hello" });
      assert.deepEqual(r, { providerMessageId: "mo-1", providerConversationId: "c-1" });
      assert.equal(calls[0].url, "https://publicapi.myoperator.co/chat/messages");
      assert.equal(calls[0].init.headers.Authorization, "Bearer key-123");
      assert.equal(calls[0].init.headers["X-MYOP-COMPANY-ID"], "comp-1");
      const body = JSON.parse(calls[0].init.body);
      assert.deepEqual(body, {
        phone_number_id: "1196177000238423", customer_country_code: "91", customer_number: "9876543210",
        data: { type: "text", context: { body: "Hello", preview_url: false } }, reply_to: null, myop_ref_id: "abc",
      });

      await wa.send({ waId: "919876543210", refId: "abd", template: { name: "start_chat", language: "en", values: { customer_name: "Ravi" } } });
      assert.deepEqual(JSON.parse(calls[1].init.body).data, { type: "template", context: { template_name: "start_chat", language: "en", body: { customer_name: "Ravi" } } });

      global.fetch = async () => new Response(JSON.stringify({ status: "error", code: "CHAT_4001", message: "Insufficient Balance" }), { status: 400 });
      await assert.rejects(wa.send({ waId: "919876543210", refId: "x", text: "Hi" }), /balance on MyOperator has run out/);
    });
    await withEnv({ WHATSAPP_PROVIDER: "" }, () => assert.rejects(wa.send({ waId: "919876543210", text: "Hi" }), /not connected/));
  } finally {
    global.fetch = savedFetch;
  }
});

test("sending through Meta: templates fill named and numbered variables; a closed window says so", async () => {
  const savedFetch = global.fetch;
  try {
    await withEnv({ WHATSAPP_PROVIDER: "meta", WHATSAPP_META_TOKEN: "tok", WHATSAPP_META_PHONE_NUMBER_ID: "555", WHATSAPP_META_APP_SECRET: "s", WHATSAPP_META_VERIFY_TOKEN: "v" }, async () => {
      let sent;
      global.fetch = async (url, init) => {
        sent = { url, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ messages: [{ id: "wamid.9" }] }), { status: 200 });
      };
      await wa.send({ waId: "919876543210", template: { name: "hello", language: "en", variables: ["1", "name"], values: { 1: "A", name: "B" } } });
      assert.match(sent.url, /\/555\/messages$/);
      assert.equal(sent.body.to, "919876543210");
      assert.deepEqual(sent.body.template.components[0].parameters, [
        { type: "text", text: "A" },
        { type: "text", text: "B", parameter_name: "name" },
      ]);
      global.fetch = async () => new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 });
      await assert.rejects(wa.send({ waId: "919876543210", text: "late" }), (e) => e.code === "WHATSAPP_WINDOW_CLOSED" && e.status === 409);
    });
  } finally {
    global.fetch = savedFetch;
  }
});

test("templates: only ones CSD can fill in are offered as sendable", () => {
  const t = wa.normaliseTemplate({ name: "a", language: "en", components: [{ type: "BODY", text: "Hi {{name}}, ticket {{2}}" }] });
  assert.deepEqual(t.variables, ["name", "2"]);
  assert.equal(t.supported, true);
  assert.equal(wa.normaliseTemplate({ name: "b", components: [{ type: "HEADER", format: "MEDIA" }, { type: "BODY", text: "x" }] }).supported, false);
  assert.equal(wa.fillTemplate("Hi {{name}}", { name: "Ravi" }), "Hi Ravi");
});

test("receipts only move a message forward", () => {
  assert.equal(advances("pending", "sent"), true);
  assert.equal(advances("sent", "read"), true);
  assert.equal(advances("read", "delivered"), false, "a late 'delivered' never undoes 'read'");
  assert.equal(advances("sent", "failed"), true);
  assert.equal(advances("delivered", "failed"), false);
  assert.equal(advances("failed", "sent"), false);
  assert.equal(preview({ type: "image", body: "" }), "Photo");
  assert.equal(preview({ type: "text", body: "a\n b" }), "a b");
});

const res = () => {
  const r = { statusCode: 0, body: null };
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  return r;
};

test("a free-text reply after 24 hours is refused with a code the screen acts on; notes are always allowed", async () => {
  const saved = { find: WaConversation.findById, create: WaMessage.create };
  const conv = { _id: new mongoose.Types.ObjectId(), waId: "919876543210", lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000), status: "open" };
  WaConversation.findById = () => ({ lean: async () => conv });
  const created = [];
  WaMessage.create = async (doc) => (created.push(doc), { ...doc, _id: new mongoose.Types.ObjectId(), toObject() { return { ...doc, _id: this._id }; } });
  try {
    const req = (body) => ({ params: { id: String(conv._id) }, body, csdStaff: { _id: new mongoose.Types.ObjectId(), fullName: "Agent" } });
    let err;
    await ctl.postMessage(req({ text: "Hello?" }), res(), (e) => (err = e));
    assert.equal(err.status, 409);
    assert.equal(err.code, "WHATSAPP_WINDOW_CLOSED");
    assert.equal(created.length, 0, "nothing was recorded as sent");

    const r = res();
    err = undefined;
    await ctl.postMessage(req({ note: true, text: "Called the owner" }), r, (e) => (err = e));
    assert.equal(err, undefined);
    assert.equal(r.statusCode, 201);
    assert.equal(created[0].direction, "note");
  } finally {
    WaConversation.findById = saved.find;
    WaMessage.create = saved.create;
  }
});

test("the MyOperator webhook refuses a wrong token before reading anything", async () => {
  await withEnv(MYOP, async () => {
    const r = res();
    await ctl.myoperatorWebhook({ params: { token: "wrong" }, body: received }, r);
    assert.equal(r.statusCode, 404);
  });
});

/* ---------------------------------------------------------- Fast2SMS (2026-11-10) */

const F2S = {
  WHATSAPP_PROVIDER: "fast2sms",
  FAST2SMS_API_KEY: "f2s-key",
  FAST2SMS_WA_PHONE_NUMBER_ID: "1122334455",
  FAST2SMS_WEBHOOK_SECRET: "x".repeat(40),
};

test("Fast2SMS incoming messages (its documented samples) become customer messages", async () => {
  await withEnv(F2S, () => {
    const [t] = wa.parseFast2sms({ webhook_type: "incoming_message", from: "919999999999", message_type: "text", body: "Where is my order?", message_id: "wamid.HBgMOTE5", phone_number_id: "1122334455", status: "received", timestamp: "1753604100", media_url: "", mime_type: "", caption: "" });
    assert.equal(t.kind, "message");
    assert.equal(t.direction, "in");
    assert.equal(t.waId, "919999999999");
    assert.equal(t.body, "Where is my order?");
    assert.equal(t.providerMessageId, "wamid.HBgMOTE5");
    assert.equal(t.media, undefined);
    assert.equal(t.at.toISOString(), new Date(1753604100 * 1000).toISOString());

    const [img] = wa.parseFast2sms({ webhook_type: "incoming_message", status: "received", phone_number_id: "1122334455", from: "919999999999", message_id: "wamid.2", message_type: "image", body: "Here is the payment screenshot", media_url: "https://media.example.com/wa/img_8f3a2c.jpg", mime_type: "image/jpeg", caption: "Paid via UPI", timestamp: "1753604100" });
    assert.equal(img.media.url, "https://media.example.com/wa/img_8f3a2c.jpg");
    assert.equal(img.body, "Here is the payment screenshot");

    assert.deepEqual(wa.parseFast2sms({ webhook_type: "incoming_message", phone_number_id: "999", from: "919999999999", message_id: "w", body: "x" }), [], "another number on the account is ignored");
  });
});

test("Fast2SMS receipts match by WhatsApp message id and carry the failure reason", async () => {
  await withEnv(F2S, () => {
    const [r] = wa.parseFast2sms({ webhook_type: "status_update", status: "read", message_id: "wamid.out", phone_number_id: "1122334455", recipient_id: "919999999999", error_message: "", timestamp: "1753603800" });
    assert.deepEqual([r.kind, r.status, r.providerMessageId, r.error], ["status", "read", "wamid.out", ""]);
    const [f] = wa.parseFast2sms({ webhook_type: "status_update", status: "failed", message_id: "wamid.f", failure_reason: "Re-engagement message", errors: "" });
    assert.equal(f.error, "Re-engagement message");
    const [g] = wa.parseFast2sms({ webhook_type: "status_update", status: "failed", message_id: "wamid.g", failure_reason: "", errors: "", status_description: "Message undeliverable" });
    assert.equal(g.error, "Message undeliverable");
    assert.deepEqual(wa.parseFast2sms({ webhook_type: "status_update", status: "", message_id: "" }), []);
  });
});

test("Fast2SMS sends through its Meta-format endpoint with the account key; the webhook needs its secret header", async () => {
  const savedFetch = global.fetch;
  try {
    await withEnv(F2S, async () => {
      assert.equal(wa.isConfigured(), true);
      let sent;
      global.fetch = async (url, init) => {
        sent = { url, init };
        return new Response(JSON.stringify({ messaging_product: "whatsapp", messages: [{ id: "wamid.sent" }] }), { status: 200 });
      };
      const r = await wa.send({ waId: "919876543210", text: "Hello" });
      assert.equal(r.providerMessageId, "wamid.sent", "the id the read receipts will carry");
      assert.equal(sent.url, "https://www.fast2sms.com/dev/whatsapp/v26.0/1122334455/messages");
      assert.equal(sent.init.headers.Authorization, "f2s-key");
      assert.deepEqual(JSON.parse(sent.init.body), { messaging_product: "whatsapp", recipient_type: "individual", to: "919876543210", type: "text", text: { body: "Hello", preview_url: false } });

      global.fetch = async (url) => {
        sent = { url };
        return new Response(JSON.stringify({ success: "true", data: [{ phone_number_id: "1122334455", templates: [
          { template_name: "support_followup", language: "en", status: "APPROVED", phone_number_id: "1122334455", components: [{ type: "BODY", text: "Hi {{1}}, KnotKitchen support here." }] },
          { template_name: "draft_one", language: "en", status: "PENDING", phone_number_id: "1122334455", components: [] },
        ] }] }), { status: 200 });
      };
      const list = await wa.listTemplates();
      assert.match(sent.url, /\/dev\/dlt_manager\/whatsapp\?type=template&phone_number_id=1122334455$/);
      assert.deepEqual(list.map((t) => [t.name, t.variables]), [["support_followup", ["1"]]]);

      assert.equal(wa.verifyFast2smsSecret("x".repeat(40)), true);
      assert.equal(wa.verifyFast2smsSecret("y".repeat(40)), false);
      const r401 = res();
      await ctl.fast2smsWebhook({ get: () => "wrong", body: {} }, r401);
      assert.equal(r401.statusCode, 401);
    });
  } finally {
    global.fetch = savedFetch;
  }
});
