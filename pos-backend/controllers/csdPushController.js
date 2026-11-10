const createHttpError = require("http-errors");
const { CsdPushSubscription } = require("../models/csdPushModel");
const push = require("../services/csdPush");

/**
 * CSD → push notifications on this device. Every route acts on the signed-in
 * staff member's own devices only.
 */

/** GET /api/csd/push — the server's public key, and how many devices of yours are on. */
const getPush = async (req, res, next) => {
  try {
    const [publicKey, devices] = await Promise.all([
      push.publicKey(),
      CsdPushSubscription.countDocuments({ staffId: req.csdStaff._id }),
    ]);
    res.status(200).json({ success: true, data: { publicKey, devices } });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/csd/push/status { endpoint } — is this device on for you? A POST
 * so the device's push address never sits in a URL (access logs keep those).
 */
const status = async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || "").slice(0, 2000);
    const subscribed = endpoint ? !!(await CsdPushSubscription.exists({ staffId: req.csdStaff._id, endpoint })) : false;
    res.status(200).json({ success: true, data: { subscribed } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/push/subscribe { subscription } — switch this device on. */
const subscribe = async (req, res, next) => {
  try {
    const s = req.body?.subscription;
    if (!push.isValidSubscription(s)) return next(createHttpError(400, "This browser gave an invalid push subscription."));
    // A device belongs to whoever switched it on last (a shared desk computer).
    await CsdPushSubscription.findOneAndUpdate(
      { endpoint: s.endpoint },
      {
        $set: {
          staffId: req.csdStaff._id,
          keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
          userAgent: String(req.get("user-agent") || "").slice(0, 300),
        },
      },
      { upsert: true, new: true }
    );
    res.status(200).json({ success: true, data: { subscribed: true } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/push/unsubscribe { endpoint } — switch this device off. */
const unsubscribe = async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || "");
    if (endpoint) await CsdPushSubscription.deleteOne({ staffId: req.csdStaff._id, endpoint });
    res.status(200).json({ success: true, data: { subscribed: false } });
  } catch (error) {
    next(error);
  }
};

/** POST /api/csd/push/test — a test notification to the caller's own devices. */
const test = async (req, res, next) => {
  try {
    const r = await push.notify(
      { title: "KnotKitchen Business", body: "Notifications are on. New WhatsApp messages will show up like this.", url: "/chat?tab=whatsapp", tag: "test" },
      { staffIds: [req.csdStaff._id] }
    );
    if (!r.sent) return next(createHttpError(409, "No device of yours is switched on for notifications."));
    res.status(200).json({ success: true, data: r });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPush, status, subscribe, unsubscribe, test };
