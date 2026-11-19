const express = require("express");
const bcrypt = require("bcrypt");
const createHttpError = require("http-errors");
const config = require("../config/config");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const User = require("../models/userModel");
const Order = require("../models/orderModel");
const { Rider, RiderPushSubscription } = require("../models/riderModel");
const csdPush = require("../services/csdPush");
const riders = require("../services/riders");

/**
 * The KnotKitchen Rider app's API (knotkitchen.com/rider -> Caddy ->
 * /api/rider). Every route but sign-up, sign-in and PIN reset needs the
 * rider's own session (services/riders requireRider); every delivery route
 * also needs an active account, and only ever reads or moves an order whose
 * delivery is the rider's, in the rider's store.
 */
const router = express.Router();

const ok = (res, data = {}) => res.status(200).json({ success: true, data });
const fail = (status, message, code) => createHttpError(status, message, code ? { code } : undefined);

// Sign-in, sign-up and PIN reset: per phone and per address, like the POS.
const authLimiter = rateLimit({
  windowMs: config.authLoginRateWindowMs,
  max: config.authLoginRateMax,
  keyGenerator: (req) => `rider-auth:${clientIp(req)}:${riders.cleanPhone(req.body?.phone)}`,
  message: "Too many attempts. Please wait a few minutes and try again.",
});
const stepLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyGenerator: (req) => `rider-step:${clientIp(req)}`,
  message: "Too many requests. Please slow down.",
});

/** The store a Store ID names: its owner login carries the restaurant. */
const storeFor = async (storeId) => {
  if (!/^\d{6}$/.test(String(storeId || ""))) return null;
  const owner = await User.findOne({ storeId: String(storeId), role: "Owner", isDeleted: { $ne: true } }).select("restaurantId storeId").lean();
  return owner?.restaurantId ? { storeId: String(storeId), restaurantId: owner.restaurantId } : null;
};

const meView = async (rider) => {
  const [profile, waiting] = await Promise.all([
    riders.profileView(rider),
    Order.countDocuments({ "delivery.riderId": rider._id, "delivery.status": "assigned", isDeleted: { $ne: true } }),
  ]);
  return { ...profile, newDeliveries: waiting };
};

/* ---------------------------------------------------------------- account -- */

// POST /api/rider/auth/signup { storeId, phone, name, pin, code? }
router.post("/auth/signup", authLimiter, async (req, res, next) => {
  try {
    const phone = riders.cleanPhone(req.body?.phone);
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const pin = String(req.body?.pin || "");
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (!phone) throw fail(400, "Enter a valid 10-digit mobile number.", "BAD_PHONE");
    if (name.length < 2) throw fail(400, "Enter your name.", "BAD_NAME");
    const pinIssue = riders.pinProblem(pin);
    if (pinIssue) throw fail(400, pinIssue, "BAD_PIN");
    const store = await storeFor(req.body?.storeId);
    if (!store) throw fail(404, "No store has that Store ID. Check it with your restaurant.", "STORE_NOT_FOUND");

    let rider = await Rider.findOne({ phone });
    if (rider && rider.storeId !== store.storeId) {
      if (rider.status !== "deactivated") throw fail(409, "This number is already registered with another store.", "OTHER_STORE");
      // Removed by their old store: free to join this one, as a new rider.
      riders.moveToStore(rider, store);
    }
    if (rider && rider.pinHash && rider.status !== "deactivated") {
      throw fail(409, "You're already registered. Sign in with your PIN.", "ALREADY_REGISTERED");
    }
    const invited = rider && riders.codeMatches(rider, "invite", code);
    if (!rider) rider = new Rider({ storeId: store.storeId, restaurantId: store.restaurantId, phone });
    rider.name = name;
    rider.pinHash = await riders.hashPin(pin);
    rider.failedPins = 0;
    rider.lockedUntil = null;
    rider.online = false;
    if (invited) {
      // The store invited this number and the rider has the code: in straight away.
      rider.status = "active";
      rider.approvedAt = new Date();
      rider.approvedBy = "Invitation";
      riders.clearCode(rider);
    } else {
      rider.status = "pending";
      rider.statusNote = "";
    }
    await riders.startSession(rider, req, res, { remember: true });
    riders.announceRider(rider);
    ok(res, { rider: await meView(rider) });
  } catch (err) {
    if (err?.code === 11000) return next(fail(409, "This number is already registered. Sign in instead.", "ALREADY_REGISTERED"));
    next(err);
  }
});

// POST /api/rider/auth/login { phone, pin, remember }
router.post("/auth/login", authLimiter, async (req, res, next) => {
  try {
    const phone = riders.cleanPhone(req.body?.phone);
    const pin = String(req.body?.pin || "");
    if (!phone || !/^\d{4,6}$/.test(pin)) throw fail(400, "Enter your mobile number and PIN.", "BAD_INPUT");
    const rider = await Rider.findOne({ phone });
    // One answer for an unknown number and a wrong PIN.
    const wrong = () => fail(401, "That mobile number and PIN don't match.", "INVALID_PIN");
    if (!rider || !rider.pinHash) throw wrong();
    if (rider.lockedUntil && rider.lockedUntil > new Date()) {
      const mins = Math.ceil((rider.lockedUntil - Date.now()) / 60000);
      throw fail(429, `Too many wrong PINs. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or reset your PIN.`, "LOCKED");
    }
    if (!(await bcrypt.compare(pin, rider.pinHash))) {
      rider.failedPins = (rider.failedPins || 0) + 1;
      if (rider.failedPins >= riders.MAX_FAILED_PINS) {
        rider.failedPins = 0;
        rider.lockedUntil = new Date(Date.now() + riders.LOCK_MS);
      }
      await rider.save();
      throw wrong();
    }
    if (rider.status === "deactivated") throw fail(403, "Your store has removed this account. Contact them to rejoin.", "RIDER_DEACTIVATED");
    rider.failedPins = 0;
    rider.lockedUntil = null;
    await riders.startSession(rider, req, res, { remember: req.body?.remember !== false });
    ok(res, { rider: await meView(rider) });
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/auth/reset-pin { phone, code, pin } -- the code the store gave (Settings > Delivery Riders > Reset PIN).
router.post("/auth/reset-pin", authLimiter, async (req, res, next) => {
  try {
    const phone = riders.cleanPhone(req.body?.phone);
    const pin = String(req.body?.pin || "");
    const rider = phone ? await Rider.findOne({ phone }) : null;
    if (!rider || rider.status === "deactivated" || !riders.codeMatches(rider, "reset", req.body?.code)) {
      throw fail(400, "That code isn't right or has expired. Ask your store for a new one.", "BAD_CODE");
    }
    const pinIssue = riders.pinProblem(pin);
    if (pinIssue) throw fail(400, pinIssue, "BAD_PIN");
    rider.pinHash = await riders.hashPin(pin);
    riders.clearCode(rider);
    rider.failedPins = 0;
    rider.lockedUntil = null;
    riders.revokeAllSessions(rider);
    require("../services/socket").disconnectRider(String(rider._id));
    await riders.startSession(rider, req, res, { remember: true });
    ok(res, { rider: await meView(rider) });
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/auth/logout { endpoint? } -- this device only; offline when it was the last one.
router.post("/auth/logout", async (req, res, next) => {
  try {
    const found = await riders.riderFromToken(req.cookies?.[riders.COOKIE]);
    if (found) {
      const { rider, session } = found;
      session.revokedAt = new Date();
      const endpoint = String(req.body?.endpoint || "");
      if (endpoint) await RiderPushSubscription.deleteOne({ riderId: rider._id, endpoint });
      const now = new Date();
      if (!rider.sessions.some((s) => !s.revokedAt && s.expiresAt > now)) rider.online = false;
      await rider.save();
      riders.announceRider(rider);
    }
    riders.clearCookie(res);
    ok(res);
  } catch (err) {
    next(err);
  }
});

router.use(riders.requireRider);

// GET /api/rider/me
router.get("/me", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    ok(res, { rider: await meView(req.rider) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/rider/me { name?, prefs? } -- never the phone or the store.
router.patch("/me", async (req, res, next) => {
  try {
    const { name, prefs } = req.body || {};
    if (name !== undefined) {
      const clean = String(name).replace(/\s+/g, " ").trim().slice(0, 60);
      if (clean.length < 2) throw fail(400, "Enter your name.");
      req.rider.name = clean;
    }
    if (prefs && typeof prefs === "object") {
      if (typeof prefs.sound === "boolean") req.rider.prefs.sound = prefs.sound;
      if (typeof prefs.vibration === "boolean") req.rider.prefs.vibration = prefs.vibration;
    }
    await req.rider.save();
    ok(res, { rider: await meView(req.rider) });
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/me/pin { currentPin, newPin }
router.post("/me/pin", authLimiter, async (req, res, next) => {
  try {
    const { currentPin, newPin } = req.body || {};
    if (!(await bcrypt.compare(String(currentPin || ""), req.rider.pinHash || ""))) throw fail(400, "Your current PIN isn't right.", "INVALID_PIN");
    const pinIssue = riders.pinProblem(newPin);
    if (pinIssue) throw fail(400, pinIssue, "BAD_PIN");
    if (String(currentPin) === String(newPin)) throw fail(400, "Choose a PIN different from the current one.", "BAD_PIN");
    req.rider.pinHash = await riders.hashPin(newPin);
    // Every other device signs in again with the new PIN.
    const keep = String(req.riderSession._id);
    req.rider.sessions.forEach((s) => {
      if (String(s._id) !== keep && !s.revokedAt) s.revokedAt = new Date();
    });
    await req.rider.save();
    ok(res);
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/availability { online }
router.post("/availability", riders.requireActiveRider, async (req, res, next) => {
  try {
    const online = req.body?.online === true;
    req.rider.online = online;
    if (online) req.rider.onlineAt = new Date();
    await req.rider.save();
    riders.announceRider(req.rider);
    ok(res, { rider: await meView(req.rider) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------- deliveries -- */

const RANGES = { today: 0, yesterday: 1, week: 7, month: 30 };
/** [from, to) in IST for a history filter. */
const rangeOf = (range) => {
  const IST = 5.5 * 60 * 60 * 1000;
  const now = Date.now();
  const startToday = new Date(Math.floor((now + IST) / 864e5) * 864e5 - IST);
  if (range === "yesterday") return [new Date(startToday - 864e5), startToday];
  if (range === "week") return [new Date(startToday - 6 * 864e5), new Date(now + 60_000)];
  if (range === "month") return [new Date(startToday - 29 * 864e5), new Date(now + 60_000)];
  return [startToday, new Date(now + 60_000)];
};

// GET /api/rider/deliveries?scope=active|history&range=today|yesterday|week|month&q=
router.get("/deliveries", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const base = { storeId: req.rider.storeId, "delivery.riderId": req.rider._id, isDeleted: { $ne: true } };
    if (req.query.scope === "history") {
      const range = Object.prototype.hasOwnProperty.call(RANGES, req.query.range) ? req.query.range : "today";
      const [from, to] = rangeOf(range);
      const filter = { ...base, "delivery.status": { $in: ["delivered", "cancelled"] }, "delivery.assignedAt": { $gte: from, $lt: to } };
      const q = String(req.query.q || "").trim().slice(0, 40);
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ orderNumber: rx }, { "customerDetails.name": rx }];
      }
      const orders = await Order.find(filter).sort({ "delivery.assignedAt": -1 }).limit(200);
      const list = orders.map((o) => riders.deliveryView(o));
      const delivered = list.filter((d) => d.stage === "delivered");
      return ok(res, {
        deliveries: list,
        summary: { delivered: delivered.length, value: Math.round(delivered.reduce((s, d) => s + d.bills.total, 0) * 100) / 100 },
      });
    }
    // Active: what the rider is working on, plus anything cancelled under them in the last hour so they see it.
    const orders = await Order.find({
      ...base,
      $or: [
        { "delivery.status": { $in: riders.OPEN } },
        { "delivery.status": "cancelled", "delivery.cancelledAt": { $gte: new Date(Date.now() - 60 * 60 * 1000) } },
      ],
    }).sort({ "delivery.assignedAt": 1 });
    ok(res, { deliveries: orders.map((o) => riders.deliveryView(o)) });
  } catch (err) {
    next(err);
  }
});

// GET /api/rider/deliveries/:id
router.get("/deliveries/:id", async (req, res, next) => {
  try {
    res.set("Cache-Control", "no-store");
    const order = await riders.riderOrder(req.rider, req.params.id);
    ok(res, { delivery: riders.deliveryView(order, { store: await riders.storeInfo(order.restaurantId) }) });
  } catch (err) {
    next(err);
  }
});

// A rider suspended mid-ride can still finish what is already on the road
// (arrived, delivered); nothing new.
const finishingOnly = (req, res, next) => (req.rider?.status === "suspended" ? next() : riders.requireActiveRider(req, res, next));
const act = (fn, guard = riders.requireActiveRider) => [
  stepLimiter,
  guard,
  async (req, res, next) => {
    try {
      const order = await fn(req);
      ok(res, { delivery: riders.deliveryView(order, { store: await riders.storeInfo(order.restaurantId) }) });
    } catch (err) {
      next(err);
    }
  },
];

router.post("/deliveries/:id/accept", ...act((req) => riders.acceptDelivery(req.rider, req.params.id)));
router.post("/deliveries/:id/reject", ...act((req) => riders.rejectDelivery(req.rider, req.params.id, req.body || {})));
router.post("/deliveries/:id/start", ...act((req) => riders.startDelivery(req.rider, req.params.id)));
router.post("/deliveries/:id/arrived", ...act((req) => riders.arriveDelivery(req.rider, req.params.id), finishingOnly));
router.post("/deliveries/:id/delivered", ...act((req) => riders.completeDelivery(req.rider, req.params.id, { collected: req.body?.collected === true, code: req.body?.code }), finishingOnly));

/* -------------------------------------------------------------------- push -- */

// GET /api/rider/push?endpoint= -- the server's key and whether this device is on.
router.get("/push", async (req, res, next) => {
  try {
    const endpoint = String(req.query.endpoint || "");
    const [publicKey, here] = await Promise.all([
      csdPush.publicKey(),
      endpoint ? RiderPushSubscription.exists({ riderId: req.rider._id, endpoint }) : null,
    ]);
    ok(res, { publicKey, subscribed: Boolean(here) });
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/push/subscribe { subscription }
router.post("/push/subscribe", async (req, res, next) => {
  try {
    const sub = req.body?.subscription;
    if (!csdPush.isValidSubscription(sub)) throw fail(400, "This browser's notification details were not accepted.");
    // An endpoint belongs to one rider: a shared phone moves to whoever signed in last.
    await RiderPushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { $set: { riderId: req.rider._id, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent: String(req.get("user-agent") || "").slice(0, 300) } },
      { upsert: true },
    );
    const extra = await RiderPushSubscription.find({ riderId: req.rider._id }).sort({ updatedAt: -1 }).skip(5).select("_id").lean();
    if (extra.length) await RiderPushSubscription.deleteMany({ _id: { $in: extra.map((e) => e._id) } });
    ok(res);
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/push/unsubscribe { endpoint }
router.post("/push/unsubscribe", async (req, res, next) => {
  try {
    await RiderPushSubscription.deleteOne({ riderId: req.rider._id, endpoint: String(req.body?.endpoint || "") });
    ok(res);
  } catch (err) {
    next(err);
  }
});

// POST /api/rider/push/test -- a test notification to this rider's devices.
router.post("/push/test", stepLimiter, async (req, res, next) => {
  try {
    const { sent } = await riders.pushToRider(req.rider._id, { title: "Notifications are on ✅", body: "You'll hear about new deliveries here.", url: "/rider/", tag: "test" });
    ok(res, { sent });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
