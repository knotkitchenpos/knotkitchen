/* global AbortSignal */
const crypto = require("crypto");

/**
 * WhatsApp provider for the CSD support inbox.
 *
 * The support number is a Heyo virtual number. Heyo (a MyOperator product)
 * is app-only and has no API of its own; the WhatsApp Business API for it is
 * MyOperator's (publicapi.myoperator.co: send messages + webhooks for
 * message.received / sent / delivered / read / failed). Meta's own WhatsApp
 * Cloud API is the alternative if the number is moved there instead. Both are
 * supported behind the same three functions — send, parse a webhook, list
 * templates — and WHATSAPP_PROVIDER picks one:
 *
 *   WHATSAPP_PROVIDER=myoperator
 *     MYOPERATOR_API_KEY          Panel → API & Webhook → WhatsApp APIs → API key
 *     MYOPERATOR_COMPANY_ID       sent as X-MYOP-COMPANY-ID
 *     MYOPERATOR_PHONE_NUMBER_ID  the support number's phone_number_id
 *     MYOPERATOR_WABA_ID          optional, narrows the template list
 *   WHATSAPP_PROVIDER=meta
 *     WHATSAPP_META_TOKEN, WHATSAPP_META_PHONE_NUMBER_ID, WHATSAPP_META_WABA_ID,
 *     WHATSAPP_META_APP_SECRET (checks X-Hub-Signature-256),
 *     WHATSAPP_META_VERIFY_TOKEN (the subscribe handshake),
 *     WHATSAPP_META_GRAPH_VERSION (default v23.0)
 *   WHATSAPP_PROVIDER=fast2sms  (Fast2SMS's WhatsApp Business API, the
 *     account the SMS code already uses; its "META Format" endpoints)
 *     FAST2SMS_API_KEY (or FAST2SMS_WA_API_KEY), FAST2SMS_WA_PHONE_NUMBER_ID,
 *     FAST2SMS_WEBHOOK_SECRET (Dev API → webhook signing; sent back as the
 *     x-webhook-secret header on the Fast2SMS webhook), optional FAST2SMS_WA_WABA_ID,
 *     FAST2SMS_WA_GRAPH_VERSION (default v26.0)
 *   WHATSAPP_WEBHOOK_TOKEN  the secret in the webhook URL. MyOperator signs
 *     nothing ("no auth required from your side"), so the unguessable path is
 *     what stops anyone else posting fake customer messages into the inbox.
 *
 * Read lazily, so a server without these settings boots normally and the
 * inbox just says it is not connected.
 */

const env = (k) => String(process.env[k] || "").trim();
const TIMEOUT_MS = 15000;

const providerName = () => env("WHATSAPP_PROVIDER").toLowerCase();

const isConfigured = () => {
  const p = providerName();
  if (p === "myoperator") return !!(env("MYOPERATOR_API_KEY") && env("MYOPERATOR_COMPANY_ID") && env("MYOPERATOR_PHONE_NUMBER_ID") && env("WHATSAPP_WEBHOOK_TOKEN"));
  if (p === "meta") return !!(env("WHATSAPP_META_TOKEN") && env("WHATSAPP_META_PHONE_NUMBER_ID") && env("WHATSAPP_META_APP_SECRET") && env("WHATSAPP_META_VERIFY_TOKEN"));
  if (p === "fast2sms") return !!(fast2smsKey() && env("FAST2SMS_WA_PHONE_NUMBER_ID") && env("FAST2SMS_WEBHOOK_SECRET"));
  return false;
};

class ProviderError extends Error {
  constructor(message, { status = 502, code = "WHATSAPP_PROVIDER" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ helpers */

const digits = (v) => String(v ?? "").replace(/\D/g, "");

/**
 * A number typed by an agent → WhatsApp ID. Ten digits are an Indian mobile
 * (91 added); otherwise it must already carry its country code.
 */
const normaliseWaId = (input) => {
  const raw = String(input ?? "").trim();
  let d = digits(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 && !raw.startsWith("+")) d = `91${d}`;
  return /^[1-9]\d{10,14}$/.test(d) ? d : "";
};

/** WhatsApp ID → { cc, number } for MyOperator, which wants them apart. */
const splitWaId = (waId, countryCode = "") => {
  const d = digits(waId);
  const cc = digits(countryCode);
  if (cc && d.startsWith(cc)) return { cc, number: d.slice(cc.length) };
  if (d.length === 12 && d.startsWith("91")) return { cc: "91", number: d.slice(2) };
  if (d.length === 11 && d.startsWith("1")) return { cc: "1", number: d.slice(1) };
  // Otherwise assume a 10-digit national number, which holds for most countries.
  return { cc: d.slice(0, d.length - 10), number: d.slice(-10) };
};

const toDate = (v) => {
  if (v === undefined || v === null || v === "") return new Date();
  const n = Number(v);
  const d = Number.isFinite(n) && String(v).trim() !== "" && !/[-:T]/.test(String(v)) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

const clip = (s, n = 8000) => String(s ?? "").slice(0, n);
const httpsOnly = (u) => (/^https:\/\//i.test(String(u || "")) ? String(u).slice(0, 2000) : "");

/** Body text with {{name}} / {{1}} filled in, for the copy kept in the inbox. */
const fillTemplate = (text, values = {}) =>
  String(text || "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (m, k) => (values[k] !== undefined && values[k] !== "" ? String(values[k]) : m));

const templateVariables = (text) => [...new Set([...String(text || "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)].map((m) => m[1]))];

const request = async (url, { method = "GET", headers = {}, body } = {}) => {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(err?.name === "TimeoutError" ? "WhatsApp did not answer in time. Try again." : "Could not reach WhatsApp. Try again.");
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
};

/* --------------------------------------------------------------- MyOperator */

// MYOPERATOR_API_BASE only for a local stand-in while testing.
const myopBase = () => (env("MYOPERATOR_API_BASE") || "https://publicapi.myoperator.co").replace(/\/+$/, "");

const myopHeaders = () => ({
  Authorization: `Bearer ${env("MYOPERATOR_API_KEY")}`,
  "X-MYOP-COMPANY-ID": env("MYOPERATOR_COMPANY_ID"),
});

const MYOP_ERRORS = {
  CHAT_4001: "The WhatsApp balance on MyOperator has run out. Recharge it and send again.",
  CHAT_0302: "The WhatsApp Business account is disabled on MyOperator.",
  CHAT_0303: "The support number is disabled on MyOperator.",
  CHAT_0304: "The support number is not connected on MyOperator.",
  CHAT_3001: "WhatsApp could not send this message.",
};

/** One MyOperator message (the `payload` of a webhook) → our shape. */
const myopContent = (data = {}) => {
  const type = String(data.type || "text").toLowerCase();
  const c = data.context || {};
  if (type === "text") return { type, body: clip(c.body) };
  if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    return {
      type,
      body: clip(c.caption || ""),
      media: { url: httpsOnly(c.link || c.url || c.media_url), mimeType: clip(c.mime_type, 100), filename: clip(c.filename, 200) },
    };
  }
  if (type === "template") {
    const t = c.body && typeof c.body === "object" ? c.body.context : c.body;
    return { type, body: clip(typeof t === "string" ? t : `Template: ${c.name || c.template_name || ""}`), template: { name: clip(c.name || c.template_name, 200), language: clip(c.language, 20) } };
  }
  if (type === "location") return { type, body: `Location: ${c.name ? `${c.name}, ` : ""}${c.latitude ?? ""}, ${c.longitude ?? ""}`.trim() };
  // Buttons, list replies, contacts…: show whatever text there is.
  const text = c.body || c.text || c.title || c.button_text || (c.button && c.button.text) || "";
  return { type, body: clip(text || `[${type} message]`) };
};

const myopCustomer = (body, p) => {
  const conv = p.conversation || {};
  const waId = digits(body.customer_identifier) || digits(`${conv.customer_country_code || ""}${conv.customer_contact || ""}`);
  const name = String(conv.customer_name || "").trim();
  return {
    waId,
    countryCode: digits(conv.customer_country_code),
    // MyOperator puts the number in customer_name when there is no name.
    profileName: name && digits(name) !== digits(waId) && digits(name) !== digits(conv.customer_contact) ? clip(name, 200) : "",
    providerConversationId: clip(conv.id || body.session_id, 100),
  };
};

const myopStatus = (s) => ({ sent: "sent", delivered: "delivered", read: "read", failed: "failed" })[String(s || "").toLowerCase()] || "";

const myopErrorText = (errors) => {
  if (!errors) return "";
  if (typeof errors === "string") return clip(errors, 500);
  if (typeof errors === "object") return clip(Object.entries(errors).map(([k, v]) => `${v} (${k})`).join("; "), 500);
  return "";
};

/**
 * MyOperator webhook body → events. Handles the current format
 * ({ event_type: "message.received", payload: {…} }) and the deprecated one
 * ({ type: "message", event: "delivered", data: {…} }).
 */
const parseMyOperator = (body) => {
  if (!body || typeof body !== "object") return [];
  let eventType = "";
  let p = null;
  if (body.event_type && body.payload) {
    eventType = String(body.event_type);
    p = body.payload;
  } else if (body.type === "message" && body.data) {
    p = body.data;
    const action = String(p.action || "").toLowerCase();
    eventType = action === "incoming" ? "message.received" : `message.${String(body.event || p.status || "sent").toLowerCase()}`;
  }
  if (!p || typeof p !== "object") return [];
  if (body.channel && String(body.channel).toLowerCase() !== "whatsapp") return [];

  const customer = myopCustomer(body, p);
  const at = toDate(p.created || body.timestamp);
  const providerMessageId = clip(p.id, 200);
  const refId = clip(p.metadata?.myop_ref_id, 200);

  if (eventType === "message.received") {
    if (!customer.waId || !providerMessageId) return [];
    return [{ kind: "message", direction: "in", ...customer, providerMessageId, at, ...myopContent(p.data) }];
  }

  const status = myopStatus(eventType.split(".")[1]);
  if (!status) return [];
  const out = {
    kind: "status",
    providerMessageId,
    refId,
    status,
    error: status === "failed" ? myopErrorText(p.metadata?.errors) || "WhatsApp could not deliver this message." : "",
    at: toDate(body.timestamp || p.modified),
  };
  // A message sent from outside CSD (MyOperator's own panel or app): add it to
  // the history too, so the thread is complete whichever app replied.
  if (eventType === "message.sent" && customer.waId && providerMessageId) {
    return [{ kind: "message", direction: "out", external: true, ...customer, providerMessageId, refId, at, status: "sent", ...myopContent(p.data) }, out];
  }
  return [out];
};

const myopSend = async ({ waId, countryCode, refId, text, template }) => {
  const { cc, number } = splitWaId(waId, countryCode);
  const data = template
    ? { type: "template", context: { template_name: template.name, language: template.language || "en", ...(template.values && Object.keys(template.values).length ? { body: template.values } : {}) } }
    : { type: "text", context: { body: text, preview_url: false } };
  const r = await request(`${myopBase()}/chat/messages`, {
    method: "POST",
    headers: myopHeaders(),
    body: {
      phone_number_id: env("MYOPERATOR_PHONE_NUMBER_ID"),
      customer_country_code: cc,
      customer_number: number,
      data,
      reply_to: null,
      myop_ref_id: refId,
    },
  });
  const j = r.json || {};
  if (!r.ok || j.status !== "success") {
    const code = String(j.code || "");
    throw new ProviderError(MYOP_ERRORS[code] || j.message || `WhatsApp refused the message (${r.status}).`, { status: 502, code: "WHATSAPP_SEND_FAILED" });
  }
  return {
    providerMessageId: clip(j.data?.message_id, 200),
    providerConversationId: clip(j.data?.conversation_id || j.data?.conversaton_id, 100),
  };
};

const myopTemplates = async () => {
  const q = new URLSearchParams({ waba_template_status: "approved", limit: "100", offset: "0" });
  if (env("MYOPERATOR_WABA_ID")) q.set("waba_id", env("MYOPERATOR_WABA_ID"));
  const r = await request(`${myopBase()}/chat/templates?${q}`, { headers: myopHeaders() });
  if (!r.ok) throw new ProviderError(r.json?.message || `Could not load WhatsApp templates (${r.status}).`);
  return (r.json?.data?.results || []).map((t) => normaliseTemplate(t));
};

/* --------------------------------------------------------------------- Meta */

/**
 * Where Meta-format calls go. Fast2SMS runs the same WhatsApp Cloud API
 * behind its own URL and API key (docs.fast2sms.com, "META Format"), so
 * sending and templates are shared; only the address and the key differ.
 */
const cloud = () => (providerName() === "fast2sms"
  ? {
      base: `https://www.fast2sms.com/dev/whatsapp/${env("FAST2SMS_WA_GRAPH_VERSION") || "v26.0"}`,
      headers: { Authorization: fast2smsKey() },
      phoneId: env("FAST2SMS_WA_PHONE_NUMBER_ID"),
      wabaId: env("FAST2SMS_WA_WABA_ID"),
    }
  : {
      base: `https://graph.facebook.com/${env("WHATSAPP_META_GRAPH_VERSION") || "v23.0"}`,
      headers: { Authorization: `Bearer ${env("WHATSAPP_META_TOKEN")}` },
      phoneId: env("WHATSAPP_META_PHONE_NUMBER_ID"),
      wabaId: env("WHATSAPP_META_WABA_ID"),
    });
const graph = (path) => `${cloud().base}/${path}`;
const metaHeaders = () => cloud().headers;

const metaContent = (m) => {
  const type = String(m.type || "text");
  if (type === "text") return { type, body: clip(m.text?.body) };
  if (["image", "video", "audio", "document", "sticker"].includes(type)) {
    const x = m[type] || {};
    // Meta gives a media id, not a link; CSD fetches it through /media/:id.
    return { type, body: clip(x.caption || ""), media: { url: x.id ? `meta:${String(x.id).replace(/\D/g, "")}` : "", mimeType: clip(x.mime_type, 100), filename: clip(x.filename, 200) } };
  }
  if (type === "button") return { type, body: clip(m.button?.text) };
  if (type === "interactive") {
    const i = m.interactive || {};
    return { type, body: clip(i.button_reply?.title || i.list_reply?.title || "[reply]") };
  }
  if (type === "location") return { type, body: `Location: ${m.location?.name ? `${m.location.name}, ` : ""}${m.location?.latitude ?? ""}, ${m.location?.longitude ?? ""}` };
  if (type === "reaction") return { type, body: `Reacted ${m.reaction?.emoji || ""}`.trim() };
  if (type === "contacts") return { type, body: `Shared a contact: ${(m.contacts || []).map((c) => c.name?.formatted_name).filter(Boolean).join(", ")}` };
  return { type, body: `[${type} message]` };
};

const parseMeta = (body) => {
  if (!body || body.object !== "whatsapp_business_account") return [];
  const events = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      if (env("WHATSAPP_META_PHONE_NUMBER_ID") && v.metadata?.phone_number_id && String(v.metadata.phone_number_id) !== env("WHATSAPP_META_PHONE_NUMBER_ID")) continue;
      const names = new Map((v.contacts || []).map((c) => [digits(c.wa_id), clip(c.profile?.name, 200)]));
      for (const m of v.messages || []) {
        const waId = digits(m.from);
        if (!waId || !m.id) continue;
        events.push({ kind: "message", direction: "in", waId, profileName: names.get(waId) || "", providerMessageId: clip(m.id, 200), at: toDate(m.timestamp), ...metaContent(m) });
      }
      for (const s of v.statuses || []) {
        const status = myopStatus(s.status);
        if (!status || !s.id) continue;
        const e = (s.errors || [])[0];
        events.push({
          kind: "status",
          providerMessageId: clip(s.id, 200),
          status,
          error: status === "failed" ? clip(e ? `${e.error_data?.details || e.message || e.title} (${e.code})` : "WhatsApp could not deliver this message.", 500) : "",
          at: toDate(s.timestamp),
        });
      }
    }
  }
  return events;
};

const metaSend = async ({ waId, text, template }) => {
  const payload = template
    ? {
        type: "template",
        template: {
          name: template.name,
          language: { code: template.language || "en" },
          ...(template.variables?.length
            ? { components: [{ type: "body", parameters: template.variables.map((v) => ({ type: "text", text: String(template.values?.[v] ?? ""), ...(/^\d+$/.test(v) ? {} : { parameter_name: v }) })) }] }
            : {}),
        },
      }
    : { type: "text", text: { body: text, preview_url: false } };
  const r = await request(graph(`${cloud().phoneId}/messages`), {
    method: "POST",
    headers: metaHeaders(),
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: waId, ...payload },
  });
  if (!r.ok) {
    const e = r.json?.error || {};
    const outside = e.code === 131047 || e.error_subcode === 2388109;
    throw new ProviderError(
      outside ? "More than 24 hours have passed since the customer last wrote. Send an approved template instead." : e.error_data?.details || e.message || `WhatsApp refused the message (${r.status}).`,
      { status: outside ? 409 : 502, code: outside ? "WHATSAPP_WINDOW_CLOSED" : "WHATSAPP_SEND_FAILED" }
    );
  }
  return { providerMessageId: clip(r.json?.messages?.[0]?.id, 200), providerConversationId: "" };
};

const metaTemplates = async () => {
  if (!cloud().wabaId) return [];
  const r = await request(graph(`${cloud().wabaId}/message_templates?status=APPROVED&limit=100&fields=name,language,status,components,category`), { headers: metaHeaders() });
  if (!r.ok) throw new ProviderError(r.json?.error?.message || `Could not load WhatsApp templates (${r.status}).`);
  return (r.json?.data || []).map((t) => normaliseTemplate(t));
};

/** Media a customer sent (Meta only): look the id up, then fetch it with the token. */
const metaMedia = async (mediaId) => {
  const meta = await request(graph(mediaId), { headers: metaHeaders() });
  if (!meta.ok || !meta.json?.url) throw new ProviderError("This file is no longer available on WhatsApp.", { status: 404 });
  let res;
  try {
    res = await fetch(meta.json.url, { headers: metaHeaders(), signal: AbortSignal.timeout(30000) });
  } catch {
    throw new ProviderError("Could not fetch the file from WhatsApp.");
  }
  if (!res.ok) throw new ProviderError("Could not fetch the file from WhatsApp.", { status: 404 });
  return { mimeType: meta.json.mime_type || res.headers.get("content-type") || "application/octet-stream", buffer: Buffer.from(await res.arrayBuffer()) };
};

/** Meta signs each webhook with the app secret over the raw body. */
const verifyMetaSignature = (rawBody, header) => {
  const secret = env("WHATSAPP_META_APP_SECRET");
  if (!secret || !rawBody || !header) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(String(header));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/* ----------------------------------------------------------------- Fast2SMS */

/** The account's Dev API key; the same one the SMS code already uses, unless WhatsApp has its own. */
const fast2smsKey = () => env("FAST2SMS_WA_API_KEY") || env("FAST2SMS_API_KEY");

/**
 * The webhook body. Fast2SMS fills @{{placeholders}} per event; the default
 * body its new panel offers for a WhatsApp webhook (seen 2026-11-11) already
 * carries every field below, so leaving it as it is works. This is the
 * smallest body that does, for reference.
 */
const FAST2SMS_WEBHOOK_PAYLOAD = {
  webhook_type: "@{{webhook_type}}",
  status: "@{{status}}",
  message_id: "@{{message_id}}",
  request_id: "@{{request_id}}",
  phone_number_id: "@{{phone_number_id}}",
  from: "@{{from}}",
  message_type: "@{{message_type}}",
  body: "@{{body}}",
  media_url: "@{{media_url}}",
  mime_type: "@{{mime_type}}",
  caption: "@{{caption}}",
  failure_reason: "@{{failure_reason}}",
  errors: "@{{errors}}",
  timestamp: "@{{timestamp}}",
};

/** WhatsApp's reason for a failed message, whichever field this panel version filled. */
const fast2smsError = (b) => {
  const e = b.failure_reason || b.error_message || b.errors || "";
  const text = typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return ""; } })();
  return clip(text && text !== "[]" && text !== "{}" ? text : b.status_description || "WhatsApp could not deliver this message.", 500);
};

/** One Fast2SMS WhatsApp webhook → events. Unfilled placeholders arrive as "". */
const parseFast2sms = (b) => {
  if (!b || typeof b !== "object") return [];
  const phoneId = env("FAST2SMS_WA_PHONE_NUMBER_ID");
  if (phoneId && b.phone_number_id && String(b.phone_number_id) !== phoneId) return [];
  const id = clip(b.message_id || b.request_id, 200);
  const at = toDate(b.timestamp);
  const kind = String(b.webhook_type || "").toLowerCase();

  if (kind === "incoming_message" || String(b.status).toLowerCase() === "received") {
    const waId = digits(b.from || b.mobile);
    if (!waId || !id) return [];
    const type = String(b.message_type || "text").toLowerCase();
    const media = ["image", "video", "audio", "document", "sticker"].includes(type);
    return [{
      kind: "message",
      direction: "in",
      waId,
      profileName: "",
      providerMessageId: id,
      at,
      type,
      body: clip(b.body || b.caption || (media ? "" : `[${type} message]`)),
      ...(media ? { media: { url: httpsOnly(b.media_url), mimeType: clip(b.mime_type, 100), filename: "" } } : {}),
    }];
  }

  const status = myopStatus(b.status);
  if (!status || !id) return [];
  return [{
    kind: "status",
    providerMessageId: id,
    status,
    error: status === "failed" ? fast2smsError(b) : "",
    at,
  }];
};

/** Fast2SMS sends the 40-character secret from Dev API settings as a header. */
const verifyFast2smsSecret = (header) => {
  const want = env("FAST2SMS_WEBHOOK_SECRET");
  if (!want || !header) return false;
  const a = crypto.createHash("sha256").update(String(header)).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
};

/** Approved templates for the number, from Fast2SMS's own WABA listing. */
const fast2smsTemplates = async () => {
  if (cloud().wabaId) return metaTemplates();
  const q = new URLSearchParams({ type: "template", phone_number_id: cloud().phoneId });
  const r = await request(`https://www.fast2sms.com/dev/dlt_manager/whatsapp?${q}`, { headers: { Authorization: fast2smsKey() } });
  if (!r.ok) throw new ProviderError(r.json?.message || `Could not load WhatsApp templates (${r.status}).`);
  const rows = [];
  for (const n of r.json?.data || []) for (const t of n.templates || (n.template_name ? [n] : [])) rows.push(t);
  return rows
    .filter((t) => !t.status || /^approved$/i.test(String(t.status)))
    .filter((t) => !t.phone_number_id || !cloud().phoneId || String(t.phone_number_id) === cloud().phoneId)
    .map((t) => normaliseTemplate({ ...t, name: t.template_name || t.name }));
};

/* ---------------------------------------------------------------- templates */

const normaliseTemplate = (t) => {
  const comps = t.components || [];
  const find = (type) => comps.find((c) => String(c.type).toUpperCase() === type) || {};
  const bodyText = find("BODY").text || "";
  const header = find("HEADER");
  const headerFormat = String(header.format || "").toUpperCase();
  const buttons = find("BUTTONS").buttons || [];
  // Only templates CSD can fill in completely: body text variables. A media
  // header or a link button with its own variable needs more than a text box.
  const mediaHeader = headerFormat && headerFormat !== "TEXT";
  const headerVars = headerFormat === "TEXT" && templateVariables(header.text).length > 0;
  const dynamicButton = buttons.some((b) => String(b.format || "").toUpperCase() === "DYNAMIC" || /\{\{/.test(b.url || ""));
  return {
    name: String(t.name || ""),
    language: String(t.language || "en"),
    category: String(t.category || "").toLowerCase(),
    header: headerFormat === "TEXT" ? String(header.text || "") : "",
    body: String(bodyText),
    footer: String(find("FOOTER").text || ""),
    variables: templateVariables(bodyText),
    supported: !mediaHeader && !headerVars && !dynamicButton,
  };
};

/* ------------------------------------------------------------------- facade */

const send = async (args) => {
  const p = providerName();
  if (!isConfigured()) throw new ProviderError("WhatsApp is not connected on this server yet.", { status: 503, code: "WHATSAPP_NOT_CONFIGURED" });
  return p === "meta" || p === "fast2sms" ? metaSend(args) : myopSend(args);
};

const listTemplates = async () => {
  if (!isConfigured()) return [];
  const p = providerName();
  if (p === "fast2sms") return fast2smsTemplates();
  return p === "meta" ? metaTemplates() : myopTemplates();
};

const parseWebhook = (provider, body) => {
  if (provider === "fast2sms") return parseFast2sms(body);
  return provider === "meta" ? parseMeta(body) : parseMyOperator(body);
};

const webhookTokenMatches = (token) => {
  const want = env("WHATSAPP_WEBHOOK_TOKEN");
  if (!want || want.length < 24 || !token) return false;
  const a = crypto.createHash("sha256").update(String(token)).digest();
  const b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
};

module.exports = {
  providerName,
  isConfigured,
  send,
  listTemplates,
  parseWebhook,
  parseMyOperator,
  parseMeta,
  parseFast2sms,
  verifyFast2smsSecret,
  FAST2SMS_WEBHOOK_PAYLOAD,
  metaMedia,
  verifyMetaSignature,
  webhookTokenMatches,
  normaliseWaId,
  splitWaId,
  fillTemplate,
  normaliseTemplate,
  ProviderError,
};
