const mongoose = require("mongoose");

/**
 * KKMDM alerts on CSD staff phones (owner, 2026-11-17).
 *
 * KKMDM opens alerts (offline, kiosk exited, outdated POS...) in its own
 * database; its own delivery is only a webhook or a logged email. Each new
 * open alert is pushed once to every CSD staff member with Device management
 * (services/csdPush, section "devices"). An alert is claimed by marking it
 * "csd-push" in its `notified` list before sending, so two runs never send
 * it twice. Same read of KKMDM's database as services/storeHealth.
 */

const MARK = "csd-push";
const LOOKBACK_MS = 60 * 60 * 1000; // an alert older than this at first sight is not news

const kkmdmDb = () => mongoose.connection.useDb(process.env.KKMDM_DB_NAME || "kkmdm", { useCache: true });

const LABEL = {
  offline: "offline",
  kiosk_exited: "kiosk exited",
  crash_loop: "POS crashing",
  low_storage: "low storage",
  low_battery: "low battery",
  not_charging: "not charging",
  policy_noncompliant: "policy not applied",
  enrollment_failed: "enrollment failed",
  pos_outdated: "POS out of date",
};

/** One pass: claim and push up to `max` new alerts. */
const pushNew = async ({ now = new Date(), max = 20, notify = require("./csdPush").notify } = {}) => {
  if (mongoose.connection.readyState !== 1) return { sent: 0 };
  const db = kkmdmDb();
  const alerts = db.collection("alerts");
  let sent = 0;
  for (let i = 0; i < max; i++) {
    const res = await alerts.findOneAndUpdate(
      { status: "open", notified: { $ne: MARK }, openedAt: { $gte: new Date(now.getTime() - LOOKBACK_MS) } },
      { $addToSet: { notified: MARK } },
      { sort: { openedAt: 1 }, returnDocument: "after" },
    );
    const a = res && Object.prototype.hasOwnProperty.call(res, "value") ? res.value : res;
    if (!a) break;
    const [device, store] = await Promise.all([
      a.deviceId ? db.collection("devices").findOne({ _id: a.deviceId }, { projection: { name: 1 } }) : null,
      a.storeId ? db.collection("stores").findOne({ _id: a.storeId }, { projection: { name: 1 } }) : null,
    ]);
    await notify(
      {
        title: `Tablet ${LABEL[a.type] || a.type}${store?.name ? ` · ${store.name}` : ""}`,
        body: `${device?.name || "A tablet"}: ${a.message || ""}`.trim(),
        url: "/mdm/alerts",
        tag: `kkmdm-${a._id}`,
      },
      { section: "devices" },
    );
    sent += 1;
  }
  return { sent };
};

let timer = null;
const startKkmdmAlertPush = () => {
  if (timer) return;
  timer = setInterval(() => {
    pushNew().catch((err) => console.error("[kkmdm-push] failed:", err?.message)); // eslint-disable-line no-console
  }, 60 * 1000);
  timer.unref?.();
};

module.exports = { pushNew, startKkmdmAlertPush, LABEL };
