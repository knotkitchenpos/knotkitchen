/**
 * Alert evaluation. Each enabled rule is checked against its store's
 * devices; a firing condition opens one alert per (rule, device), and the
 * alert resolves itself when the condition clears.
 */
const config = require("../config");
const { AlertRule, Alert, Device, Store } = require("../models");
const { inWindow } = require("./time");

const DEFAULT_THRESHOLDS = { offline: 15, low_storage: 500, low_battery: 15, crash_loop: 5, not_charging: 30 };
const SEVERITY = { offline: "critical", kiosk_exited: "critical", crash_loop: "critical", low_storage: "warning", low_battery: "warning", not_charging: "warning", policy_noncompliant: "warning", enrollment_failed: "info" };

function condition(rule, d, now) {
  const th = rule.threshold ?? DEFAULT_THRESHOLDS[rule.type];
  const t = d.telemetry || {};
  switch (rule.type) {
    case "offline":
      return !d.online && d.lastSeenAt && now - d.lastSeenAt > th * 60e3 && `Offline since ${d.lastSeenAt.toISOString()}`;
    case "kiosk_exited":
      return ["unlocked", "error"].includes(d.kiosk?.state) && `Kiosk is ${d.kiosk.state}${d.kiosk.error ? `: ${d.kiosk.error}` : ""}`;
    case "crash_loop":
      return (d.kiosk?.crashCount || 0) >= th && `POS crashed ${d.kiosk.crashCount} times recently`;
    case "low_storage":
      return t.storageFreeMb != null && t.storageFreeMb < th && `Only ${t.storageFreeMb} MB free`;
    case "low_battery":
      return t.battery != null && t.battery < th && !t.charging && `Battery ${t.battery}% and not charging`;
    case "not_charging":
      return d.online && t.charging === false && `Not charging (battery ${t.battery ?? "?"}%)`;
    case "policy_noncompliant":
      return d.policy?.compliant === false && d.enrolledAt && now - d.enrolledAt > 10 * 60e3
        && `Policy not applied${d.policy.errors?.length ? `: ${d.policy.errors[0]}` : ""}`;
    default:
      return false;
  }
}

async function notify(alert, rule, device, store) {
  const text = `[KKMDM ${alert.severity.toUpperCase()}] ${store?.name || ""} / ${device.name}: ${alert.message}`;
  const sent = [];
  const hook = rule.channels?.webhook || config.alertWebhookUrl;
  if (hook) {
    // Slack-compatible body ({text}); WhatsApp/other gateways read the same fields.
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, alert: { type: alert.type, severity: alert.severity, device: device.name, deviceId: device._id, store: store?.name, message: alert.message, at: alert.openedAt } }),
        signal: AbortSignal.timeout(5000),
      });
      sent.push("webhook");
    } catch (err) {
      console.error("[alerts] webhook failed:", err.message);
    }
  }
  if (rule.channels?.email?.length) {
    // Email needs an SMTP/transactional provider; until one is configured
    // the message is logged so nothing is silently dropped.
    console.log(`[alerts] email to ${rule.channels.email.join(", ")}: ${text}`);
    sent.push("email(log)");
  }
  return sent;
}

async function evaluate(now = new Date()) {
  const rules = await AlertRule.find({ enabled: true }).lean();
  if (!rules.length) return 0;
  const stores = new Map((await Store.find().lean()).map((s) => [String(s._id), s]));
  let opened = 0;
  for (const rule of rules) {
    const q = { companyId: rule.companyId, lifecycle: { $in: ["enrolled", "active"] } };
    if (rule.storeId) q.storeId = rule.storeId;
    const devices = await Device.find(q).lean();
    for (const d of devices) {
      const store = stores.get(String(d.storeId));
      const inHours = !rule.businessHoursOnly || !store
        || inWindow(store.businessHours?.open, store.businessHours?.close, store.timezone, now);
      const msg = inHours && condition(rule, d, now);
      const existing = await Alert.findOne({ ruleId: rule._id, deviceId: d._id, status: { $ne: "resolved" } });
      if (msg && !existing) {
        const alert = await Alert.create({ ruleId: rule._id, deviceId: d._id, storeId: d.storeId, type: rule.type, severity: SEVERITY[rule.type], message: msg });
        alert.notified = await notify(alert, rule, d, store);
        await alert.save();
        opened++;
      } else if (!msg && existing) {
        existing.status = "resolved";
        existing.resolvedAt = now;
        await existing.save();
      }
    }
  }
  return opened;
}

module.exports = { evaluate, condition, DEFAULT_THRESHOLDS };
