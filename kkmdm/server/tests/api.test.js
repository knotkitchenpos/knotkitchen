/**
 * End-to-end API tests against a throwaway database (kkmdm_test on the local
 * test mongod). Set KKMDM_TEST_MONGODB_URI to point elsewhere.
 */
const test = require("node:test");
const assert = require("node:assert");

process.env.NODE_ENV = "test";
process.env.MONGODB_URI = process.env.KKMDM_TEST_MONGODB_URI || "mongodb://127.0.0.1:27018/kkmdm_test?replicaSet=rs0";
process.env.SUPERADMIN_PASSWORD = "Test-Super-Admin-1";
process.env.SUPERADMIN_EMAIL = "super@test.local";
process.env.KNOTKITCHEN_MONGODB_URI = "";

const http = require("http");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const config = require("../src/config");
const { createApp } = require("../src/app");
const { bootstrap } = require("../src/seed");
const { verifyChain } = require("../src/lib/audit");
const { Store, Command } = require("../src/models");

let server, base;

async function call(method, p, { body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = cookie;
  if (method !== "GET") h["X-KKMDM"] = "1";
  const res = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, cookie: res.headers.get("set-cookie")?.split(";")[0] };
}

async function login(email, password) {
  const r = await call("POST", "/api/auth/login", { body: { email, password } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return r.cookie;
}

let superCookie, supportCookie, store, deviceAuth, deviceId;

test.before(async () => {
  await mongoose.connect(config.mongoUri);
  await mongoose.connection.db.dropDatabase();
  await bootstrap();
  store = await Store.create({ companyId: (await mongoose.model("Company").findOne())._id, name: "Test Store", kkStoreId: "123456" });
  server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  superCookie = await login("super@test.local", "Test-Super-Admin-1");
  // The QR needs an agent APK; fake one is fine for token tests.
  const agentFile = path.join(config.storageDir, "agent", "kk-agent.apk");
  if (!fs.existsSync(agentFile)) process.env.AGENT_APK_URL = "https://example.test/kk-agent.apk";
});

test.after(async () => {
  server?.close();
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

test("unauthenticated and CSRF-less requests are refused", async () => {
  assert.strictEqual((await call("GET", "/api/devices")).status, 401);
  const r = await fetch(`${base}/api/stores`, { method: "POST", headers: { Cookie: superCookie, "Content-Type": "application/json" }, body: "{}" });
  assert.strictEqual(r.status, 403, "missing X-KKMDM header");
});

test("enrollment: single-use token enrolls once, reuse and junk are rejected and logged", async () => {
  const t = await call("POST", "/api/enrollment/tokens", { cookie: superCookie, body: { storeId: store._id, deviceName: "Counter 1", ttlHours: 1 } });
  assert.strictEqual(t.status, 201, JSON.stringify(t.body));
  const qr = JSON.parse(t.body.qrPayload);
  assert.strictEqual(qr["android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME"], "com.knotkitchen.mdm/com.knotkitchen.mdm.AdminReceiver");
  const extras = qr["android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE"];
  assert.deepStrictEqual(Object.keys(extras).sort(), ["kkmdm_server", "kkmdm_token"], "only token + server in the QR");

  const facts = { serial: "SER-1", model: "Tab", manufacturer: "Test", androidVersion: "13", sdkInt: 33 };
  const ok = await call("POST", "/device/enroll", { body: { token: t.body.token, facts } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  assert.match(ok.body.credential, /^[a-f0-9]{24}\.[A-Za-z0-9_-]{40,}$/);
  assert.ok(ok.body.policy.settings.kiosk.enabled);
  assert.strictEqual(ok.body.managedConfig.store_id, "123456");
  assert.strictEqual(ok.body.managedConfig.pos_updates, "self", "no POS build uploaded: the POS updates itself through the agent");
  deviceAuth = `Device ${ok.body.credential}`;
  deviceId = ok.body.deviceId;

  const again = await call("POST", "/device/enroll", { body: { token: t.body.token, facts: { serial: "SER-2" } } });
  assert.strictEqual(again.status, 401);
  assert.strictEqual(again.body.error, "token_used");
  const junk = await call("POST", "/device/enroll", { body: { token: "x".repeat(43), facts: {} } });
  assert.strictEqual(junk.body.error, "token_unknown");

  const attempts = await call("GET", "/api/enrollment/attempts", { cookie: superCookie });
  const reasons = attempts.body.items.map((a) => a.reason);
  assert.ok(reasons.includes("ok") && reasons.includes("token_used") && reasons.includes("token_unknown"));
});

test("expired and revoked tokens are rejected", async () => {
  const t = await call("POST", "/api/enrollment/tokens", { cookie: superCookie, body: { storeId: store._id, ttlHours: 1 } });
  await call("POST", `/api/enrollment/tokens/${t.body.id}/revoke`, { cookie: superCookie });
  const r = await call("POST", "/device/enroll", { body: { token: t.body.token, facts: {} } });
  assert.strictEqual(r.body.error, "token_revoked");
  const t2 = await call("POST", "/api/enrollment/tokens", { cookie: superCookie, body: { storeId: store._id, ttlHours: 1 } });
  await mongoose.model("EnrollmentToken").updateOne({ _id: t2.body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r2 = await call("POST", "/device/enroll", { body: { token: t2.body.token, facts: {} } });
  assert.strictEqual(r2.body.error, "token_expired");
});

test("batch token enrolls N devices, then stops", async () => {
  const t = await call("POST", "/api/enrollment/tokens", { cookie: superCookie, body: { storeId: store._id, mode: "batch", count: 2, deviceName: "Batch" } });
  for (const s of ["B1", "B2"]) {
    const r = await call("POST", "/device/enroll", { body: { token: t.body.token, facts: { serial: s } } });
    assert.strictEqual(r.status, 200);
  }
  const r3 = await call("POST", "/device/enroll", { body: { token: t.body.token, facts: { serial: "B3" } } });
  assert.strictEqual(r3.body.error, "token_used");
});

test("device sync: heartbeat, policy compliance, command lifecycle with offline queueing", async () => {
  // Queue while the device is "offline" (no sync yet).
  const q = await call("POST", `/api/devices/${deviceId}/commands`, { cookie: superCookie, body: { type: "restart_app" } });
  assert.strictEqual(q.status, 201);
  const cmdId = q.body.command.cmdId;
  assert.strictEqual((await Command.findOne({ cmdId })).status, "queued");

  const s1 = await call("POST", "/device/sync", { headers: { Authorization: deviceAuth }, body: { telemetry: { battery: 80, charging: true }, kiosk: { state: "locked" } } });
  assert.strictEqual(s1.status, 200);
  assert.ok(s1.body.policy, "policy sent until applied");
  assert.deepStrictEqual(s1.body.commands.map((c) => c.cmdId), [cmdId]);
  assert.strictEqual((await Command.findOne({ cmdId })).status, "sent");

  for (const status of ["delivered", "executing", "succeeded"]) {
    const r = await call("POST", `/device/commands/${cmdId}`, { headers: { Authorization: deviceAuth }, body: { status, result: { ok: true } } });
    assert.strictEqual(r.status, 200);
  }
  // Late/duplicate reports never move it backwards.
  await call("POST", `/device/commands/${cmdId}`, { headers: { Authorization: deviceAuth }, body: { status: "delivered" } });
  const done = await Command.findOne({ cmdId });
  assert.strictEqual(done.status, "succeeded");
  assert.deepStrictEqual(done.history.map((h) => h.status), ["queued", "sent", "delivered", "executing", "succeeded"]);

  const s2 = await call("POST", "/device/sync", { headers: { Authorization: deviceAuth }, body: { policy: { appliedHash: s1.body.policyHash, errors: [] }, kiosk: { state: "locked" }, events: [{ type: "ready" }] } });
  assert.strictEqual(s2.body.policy, undefined, "no policy once applied");
  const d = await call("GET", `/api/devices/${deviceId}`, { cookie: superCookie });
  assert.strictEqual(d.body.device.policy.compliant, true);
  assert.strictEqual(d.body.device.lifecycle, "active");
  assert.strictEqual(d.body.device.telemetry.battery, 80);
});

test("a bad device credential is refused", async () => {
  const r = await call("POST", "/device/sync", { headers: { Authorization: `Device ${deviceId}.${"A".repeat(43)}` }, body: {} });
  assert.strictEqual(r.status, 401);
});

test("RBAC is enforced by the API: support cannot wipe or edit policies", async () => {
  const created = await call("POST", "/api/admins", { cookie: superCookie, body: { email: "support@test.local", role: "support", password: "Support-Pass-12" } });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  supportCookie = await login("support@test.local", "Support-Pass-12");

  const wipe = await call("POST", `/api/devices/${deviceId}/commands`, { cookie: supportCookie, body: { type: "wipe" } });
  assert.strictEqual(wipe.status, 403);
  const pol = await call("POST", "/api/policies", { cookie: supportCookie, body: { name: "x", settings: {} } });
  assert.strictEqual(pol.status, 403);
  const tok = await call("POST", "/api/enrollment/tokens", { cookie: supportCookie, body: { storeId: store._id } });
  assert.strictEqual(tok.status, 403);
  const restart = await call("POST", `/api/devices/${deviceId}/commands`, { cookie: supportCookie, body: { type: "restart_app" } });
  assert.strictEqual(restart.status, 201, "support may restart the POS");
  const otp = await call("POST", `/api/devices/${deviceId}/technician-otp`, { cookie: supportCookie, body: { reason: "test" } });
  assert.match(otp.body.code, /^\d{6}$/);
});

test("store users only see their own stores' devices", async () => {
  const other = await Store.create({ companyId: store.companyId, name: "Other Store" });
  await call("POST", "/api/admins", { cookie: superCookie, body: { email: "store@test.local", role: "store_user", password: "Store-Pass-123", storeIds: [String(other._id)] } });
  const c = await login("store@test.local", "Store-Pass-123");
  const list = await call("GET", "/api/devices", { cookie: c });
  assert.strictEqual(list.body.total, 0);
  const one = await call("GET", `/api/devices/${deviceId}`, { cookie: c });
  assert.strictEqual(one.status, 404);
});

test("wipe needs a fresh re-auth even for a Super Admin", async () => {
  // Push the session's authAt outside the re-auth window by issuing an old token.
  const jwt = require("jsonwebtoken");
  const admin = await mongoose.model("AdminUser").findOne({ email: "super@test.local" });
  const old = jwt.sign({ sub: String(admin._id), sv: admin.sessionVersion, authAt: Date.now() - 3600e3 }, config.adminJwtSecret, { algorithm: "HS256", expiresIn: "10m" });
  const cookie = `kkmdm_session=${old}`;
  const r = await call("POST", `/api/devices/${deviceId}/commands`, { cookie, body: { type: "wipe" } });
  assert.strictEqual(r.status, 428);
  const re = await call("POST", "/api/auth/reauth", { cookie, body: { password: "Test-Super-Admin-1" } });
  assert.strictEqual(re.status, 200);
  const r2 = await call("POST", `/api/devices/${deviceId}/commands`, { cookie: re.cookie, body: { type: "wipe" } });
  assert.strictEqual(r2.status, 201);
});

test("effective policy follows company -> store -> device and reports sources", async () => {
  const p = await call("POST", "/api/policies", { cookie: superCookie, body: { name: "Store loud", settings: { audio: { minVolumePercent: 90 } } } });
  await call("PUT", "/api/policy-assignments", { cookie: superCookie, body: { scope: "store", targetId: store._id, policyId: p.body.policy._id } });
  const eff = await call("GET", `/api/devices/${deviceId}/policy`, { cookie: superCookie });
  assert.strictEqual(eff.body.settings.audio.minVolumePercent, 90);
  assert.strictEqual(eff.body.sources["audio.minVolumePercent"], "store:Store loud");
  const bad = await call("POST", "/api/policies", { cookie: superCookie, body: { name: "typo", settings: { kiosk: { enabeld: true } } } });
  assert.strictEqual(bad.status, 400, "unknown keys are rejected");
});

test("APK import only downloads https URLs from the allowed hosts", async () => {
  for (const url of ["http://github.com/x.apk", "https://example.com/x.apk", "https://127.0.0.1/x.apk", "file:///etc/passwd", "nonsense"]) {
    const r = await call("POST", "/api/apps/import", { cookie: superCookie, body: { url } });
    assert.strictEqual(r.status, 400, url);
    assert.ok(["url_not_allowed", "bad_url"].includes(r.body.error), `${url}: ${r.body.error}`);
  }
});

test("audit log is hash-chained and verifies", async () => {
  await new Promise((r) => setTimeout(r, 200));
  const v = await verifyChain();
  assert.ok(v.ok, JSON.stringify(v));
  assert.ok(v.checked > 5);
  await mongoose.model("AuditLog").updateOne({ seq: 2 }, { $set: { action: "tampered" } });
  const v2 = await verifyChain();
  assert.strictEqual(v2.ok, false);
  assert.strictEqual(v2.brokenAtSeq, 2);
});
