const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { totp, verifyTotp, newTotpSecret, base32Decode, base32Encode, encrypt, decrypt, sha256 } = require("../src/lib/crypto");
const { deepMerge, hashSettings, DEFAULT_SETTINGS } = require("../src/lib/policy");
const { inWindow } = require("../src/lib/time");
const { can, COMMAND_PERMS } = require("../src/lib/rbac");
const { inRollout } = require("../src/lib/desiredApps");

test("TOTP matches the RFC 6238 SHA-1 test vector", () => {
  // RFC 6238 appendix B, secret "12345678901234567890", T = 59s -> 94287082 (8 digits)
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.strictEqual(totp(secret, { at: 59_000, digits: 8 }), "94287082");
  assert.strictEqual(totp(secret, { at: 1111111109_000, digits: 8 }), "07081804");
});

test("TOTP verify accepts the current code and rejects junk", () => {
  const s = newTotpSecret();
  assert.ok(verifyTotp(s, totp(s)));
  assert.ok(!verifyTotp(s, "000000") || totp(s) === "000000");
  assert.ok(!verifyTotp(s, "12ab56"));
  assert.deepStrictEqual(base32Decode(base32Encode(Buffer.from([1, 2, 3, 250]))), Buffer.from([1, 2, 3, 250]));
});

test("secrets round-trip through AES-GCM and tampering is caught", () => {
  const blob = encrypt("tech-seed");
  assert.strictEqual(decrypt(blob), "tech-seed");
  const parts = blob.split(".");
  parts[2] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decrypt(parts.join(".")));
  assert.strictEqual(sha256("x").length, 64);
});

test("policy inheritance: later levels override, arrays replace, sources recorded", () => {
  const sources = {};
  let s = deepMerge(DEFAULT_SETTINGS, { kiosk: { allowedPackages: ["a"] }, audio: { minVolumePercent: 70 } }, "store:S", sources);
  s = deepMerge(s, { kiosk: { allowedPackages: ["b"] } }, "device:D", sources);
  assert.deepStrictEqual(s.kiosk.allowedPackages, ["b"]);
  assert.strictEqual(s.audio.minVolumePercent, 70);
  assert.strictEqual(s.kiosk.enabled, true, "untouched defaults survive");
  assert.strictEqual(sources["kiosk.allowedPackages"], "device:D");
  assert.strictEqual(sources["audio.minVolumePercent"], "store:S");
  assert.strictEqual(hashSettings({ a: 1, b: 2 }), hashSettings({ b: 2, a: 1 }), "hash ignores key order");
});

test("maintenance window handles windows over midnight", () => {
  const at = (h, m) => new Date(Date.UTC(2026, 0, 1, h, m) - 5.5 * 3600e3); // IST wall clock
  assert.ok(inWindow("03:00", "06:00", "Asia/Kolkata", at(4, 0)));
  assert.ok(!inWindow("03:00", "06:00", "Asia/Kolkata", at(7, 0)));
  assert.ok(inWindow("23:00", "02:00", "Asia/Kolkata", at(1, 30)));
  assert.ok(!inWindow("23:00", "02:00", "Asia/Kolkata", at(12, 0)));
});

test("RBAC: support cannot wipe or edit policies; store user can only restart the app", () => {
  assert.ok(can("super_admin", COMMAND_PERMS.wipe));
  assert.ok(!can("admin", COMMAND_PERMS.wipe), "wipe is Super Admin only");
  assert.ok(!can("support", COMMAND_PERMS.wipe));
  assert.ok(!can("support", "policies.edit"));
  assert.ok(can("support", COMMAND_PERMS.restart_app));
  assert.ok(can("support", "technician.otp"));
  assert.ok(can("store_user", COMMAND_PERMS.restart_app));
  assert.ok(!can("store_user", COMMAND_PERMS.reboot));
});

test("rollout membership: pilot first, then a stable percentage, then all", () => {
  const r = { _id: "r1", stage: "pilot", percent: 0, storeIds: [] };
  const pilot = { _id: "d1", pilot: true };
  const normal = { _id: "d2", pilot: false };
  assert.ok(inRollout(r, pilot));
  assert.ok(!inRollout(r, normal));
  const half = { ...r, stage: "percent", percent: 50 };
  const devices = Array.from({ length: 400 }, (_, i) => ({ _id: `dev${i}` }));
  const share = devices.filter((d) => inRollout(half, d)).length / devices.length;
  assert.ok(share > 0.4 && share < 0.6, `~50% expected, got ${share}`);
  assert.strictEqual(inRollout(half, devices[7]), inRollout(half, devices[7]), "deterministic");
  assert.ok(inRollout({ ...r, stage: "all" }, normal));
  assert.ok(!inRollout({ ...r, stage: "all", storeIds: ["s1"] }, { ...normal, storeId: "s2" }));
});

test("APK inspection reads package/version and verifies the v2 signature", { skip: !fs.existsSync(path.join(__dirname, "..", "storage", "agent", "kk-agent.apk")) }, () => {
  const { inspectApk } = require("../src/lib/apk");
  const buf = fs.readFileSync(path.join(__dirname, "..", "storage", "agent", "kk-agent.apk"));
  const info = inspectApk(buf);
  assert.strictEqual(info.packageName, "com.knotkitchen.mdm");
  assert.ok(info.versionCode >= 1);
  assert.match(info.signingCertSha256, /^[0-9a-f]{64}$/);
  const bad = Buffer.from(buf);
  bad[2048] ^= 0xff;
  assert.throws(() => inspectApk(bad), /digest|signature|zip/i);
});
