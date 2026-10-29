const express = require("express");
const config = require("../config");
const { EnrollmentToken, EnrollmentAttempt, Store, Group, Policy } = require("../models");
const { wrap, HttpError, paging } = require("../lib/http");
const { requirePerm } = require("../lib/adminAuth");
const { randomToken, sha256 } = require("../lib/crypto");
const { audit } = require("../lib/audit");
const { agentDownload } = require("../lib/agentApk");

const router = express.Router();
const P = "android.app.extra.";

/**
 * Standard Android QR provisioning payload. The extras bundle carries only
 * the enrollment token and the server URL; Wi-Fi is the one credential
 * Android's design needs in the QR, and it is never stored server side.
 */
function buildQrPayload({ token, wifi }) {
  const agent = agentDownload();
  if (!agent) throw new HttpError(409, "agent_apk_missing", "Build the agent and place it in storage/agent/kk-agent.apk, or set AGENT_APK_URL");
  const payload = {
    [`${P}PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME`]: `${config.agentPackage}/${config.agentPackage}.AdminReceiver`,
    [`${P}PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION`]: agent.url,
    [`${P}PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM`]: agent.signatureChecksum,
    [`${P}PROVISIONING_SKIP_ENCRYPTION`]: true,
    [`${P}PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED`]: true,
    [`${P}PROVISIONING_TIME_ZONE`]: "Asia/Kolkata",
    [`${P}PROVISIONING_LOCALE`]: "en_IN",
    [`${P}PROVISIONING_ADMIN_EXTRAS_BUNDLE`]: {
      kkmdm_token: token,
      kkmdm_server: config.publicUrl,
    },
  };
  if (wifi?.ssid) {
    payload[`${P}PROVISIONING_WIFI_SSID`] = wifi.ssid;
    payload[`${P}PROVISIONING_WIFI_SECURITY_TYPE`] = wifi.security || "WPA";
    if (wifi.password) payload[`${P}PROVISIONING_WIFI_PASSWORD`] = wifi.password;
    if (wifi.hidden) payload[`${P}PROVISIONING_WIFI_HIDDEN`] = true;
  }
  return payload;
}

function tokenStatus(t) {
  if (t.revokedAt) return "revoked";
  if (t.uses >= t.maxUses) return "used";
  if (t.expiresAt <= new Date()) return "expired";
  return "active";
}

router.get("/agent", requirePerm("enrollment.manage"), (req, res) => {
  res.json({ agent: agentDownload() });
});

/** Creates a token and returns its QR payload. The raw token is shown once. */
router.post("/tokens", requirePerm("enrollment.manage"), wrap(async (req, res) => {
  const { storeId, groupId, policyId, deviceName, mode = "single", count, ttlHours, wifi, note } = req.body;
  const store = await Store.findById(storeId);
  if (!store) throw new HttpError(400, "store_required");
  if (groupId && !(await Group.exists({ _id: groupId, storeId: store._id }))) throw new HttpError(400, "bad_group");
  if (policyId && !(await Policy.exists({ _id: policyId }))) throw new HttpError(400, "bad_policy");
  const ttl = Math.min(Math.max(Number(ttlHours) || config.enrollTokenDefaultTtlHours, 0.25), 24 * 14);
  const maxUses = mode === "batch" ? Math.min(Math.max(parseInt(count, 10) || 10, 2), 500) : 1;

  const raw = randomToken(32);
  // Build the payload first so a missing agent APK creates no token.
  const qrPayload = buildQrPayload({ token: raw, wifi });
  const t = await EnrollmentToken.create({
    tokenHash: sha256(raw),
    hint: raw.slice(0, 6),
    companyId: store.companyId,
    storeId: store._id,
    groupId: groupId || undefined,
    policyId: policyId || undefined,
    deviceName: String(deviceName || "").trim() || `${store.name} POS`,
    mode: maxUses > 1 ? "batch" : "single",
    maxUses,
    expiresAt: new Date(Date.now() + ttl * 3600 * 1000),
    createdBy: req.admin._id,
    wifiSsid: wifi?.ssid,
    note,
  });
  await audit(req, "enrollment.token_created", {
    targetType: "enrollment_token", targetId: t._id,
    details: { store: store.name, mode: t.mode, maxUses, ttlHours: ttl, wifi: Boolean(wifi?.ssid) },
  });
  res.status(201).json({ id: t._id, token: raw, expiresAt: t.expiresAt, maxUses, qrPayload: JSON.stringify(qrPayload) });
}));

router.get("/tokens", requirePerm("enrollment.manage"), wrap(async (req, res) => {
  const { skip, limit } = paging(req);
  const q = {};
  if (req.query.storeId) q.storeId = req.query.storeId;
  const rows = await EnrollmentToken.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit)
    .populate("storeId", "name").populate("groupId", "name").populate("policyId", "name").populate("createdBy", "email").lean();
  let items = rows.map((t) => ({ ...t, tokenHash: undefined, status: tokenStatus(t) }));
  if (req.query.status) items = items.filter((t) => t.status === req.query.status);
  res.json({ items });
}));

router.post("/tokens/:id/revoke", requirePerm("enrollment.manage"), wrap(async (req, res) => {
  const t = await EnrollmentToken.findById(req.params.id);
  if (!t) throw new HttpError(404, "not_found");
  if (!t.revokedAt) {
    t.revokedAt = new Date();
    await t.save();
    await audit(req, "enrollment.token_revoked", { targetType: "enrollment_token", targetId: t._id });
  }
  res.json({ ok: true });
}));

router.get("/attempts", requirePerm("enrollment.manage"), wrap(async (req, res) => {
  const { skip, limit } = paging(req);
  const q = req.query.tokenId ? { tokenId: req.query.tokenId } : {};
  const items = await EnrollmentAttempt.find(q).sort({ at: -1 }).skip(skip).limit(limit).lean();
  res.json({ items });
}));

module.exports = { router, buildQrPayload, tokenStatus };
