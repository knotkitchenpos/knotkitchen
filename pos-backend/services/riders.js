const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const webpush = require("web-push");
const mongoose = require("mongoose");
const createHttpError = require("http-errors");
const config = require("../config/config");
const Order = require("../models/orderModel");
const Restaurant = require("../models/restaurantModel");
const { Rider, RiderPushSubscription, OPEN_DELIVERY_STATUSES } = require("../models/riderModel");
const {
  PREPARING,
  ACCEPTED,
  READY_STATUSES,
  OUT_FOR_DELIVERY,
  OUT_FOR_DELIVERY_STATUSES,
  DELIVERED,
  CANCELLED_STATUSES,
  REFUNDED_STATUSES,
  canonicalStatus,
  isCancelled,
  isRefunded,
  isSettled,
} = require("../constants/orderStatus");
const { wasPaid } = require("./refunds");

/**
 * Delivery riders: the store's own people who take its delivery orders out,
 * in the KnotKitchen Rider app (knotkitchen.com/rider).
 *
 * Sessions are a cookie of their own on knotkitchen.com under /rider, signed
 * with a key of their own, naming a session row that signing out (or the
 * store suspending the rider) revokes. A POS or Partners token can never
 * pass for one.
 *
 * Who may do what is decided here and in routes/riderRoute.js, never by the
 * app: a rider only ever reads orders whose delivery.riderId is theirs, of
 * their own store, and can only move their delivery along, never an order's
 * price, items or address.
 */

const COOKIE = "kk_rider";
const COOKIE_PATH = "/rider";
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;
const SHORT_MS = 12 * 60 * 60 * 1000;
const MAX_SESSIONS = 10;
const MAX_FAILED_PINS = 5;
const LOCK_MS = 15 * 60 * 1000;
const INVITE_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_MS = 30 * 60 * 1000;
const secret = () => `${config.accessTokenSecret}:rider`;

/** Delivery states a rider is still working on. */
const OPEN = OPEN_DELIVERY_STATUSES;
const REJECT_REASONS = ["Too far", "Not available", "Vehicle issue", "Other"];

// An order a rider can be given: accepted by the restaurant and not finished.
// "Pending" is an online order nobody has accepted yet: not this.
const ASSIGNABLE_STATUSES = [PREPARING, ACCEPTED, "preparing", "in progress", ...READY_STATUSES, ...OUT_FOR_DELIVERY_STATUSES];

const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const isId = (id) => mongoose.Types.ObjectId.isValid(String(id || "")) && /^[a-f0-9]{24}$/i.test(String(id || ""));
const fail = (status, message, code) => createHttpError(status, message, code ? { code } : undefined);

/* ----------------------------------------------------------- phone & PIN -- */

/** A 10-digit Indian mobile, from what was typed ("+91 98…", "098…"), or "". */
const cleanPhone = (raw) => {
  const digits = String(raw || "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 11 && digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : "";
};

/** Why a PIN can't be used, or "". 4 to 6 digits, not all one digit, not a plain run. */
const pinProblem = (pin) => {
  const p = String(pin ?? "");
  if (!/^\d{4,6}$/.test(p)) return "Your PIN must be 4 to 6 digits.";
  if (/^(\d)\1+$/.test(p)) return "Choose a PIN that isn't one digit repeated.";
  const up = "0123456789", down = "9876543210";
  if (up.includes(p) || down.includes(p)) return "Choose a PIN that isn't a simple run like 1234.";
  return "";
};

const hashPin = (pin) => bcrypt.hash(String(pin), 10);

/** "98XXXXXX12" */
const maskPhone = (phone) => {
  const p = String(phone || "");
  return p.length >= 4 ? `${p.slice(0, 2)}${"X".repeat(Math.max(0, p.length - 4))}${p.slice(-2)}` : p;
};

/* ------------------------------------------------------- one-time codes -- */

const codeDigest = (riderId, code) => crypto.createHash("sha256").update(`rider-code:${riderId}:${code}`).digest("hex");

/** A fresh 6-digit code for an invitation or a PIN reset; only its hash is kept. */
const issueCode = (rider, purpose) => {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  rider.codeHash = codeDigest(rider._id, code);
  rider.codePurpose = purpose;
  rider.codeExpiresAt = new Date(Date.now() + (purpose === "invite" ? INVITE_MS : RESET_MS));
  return code;
};

const codeMatches = (rider, purpose, code) => {
  if (!rider?.codeHash || rider.codePurpose !== purpose) return false;
  if (!rider.codeExpiresAt || rider.codeExpiresAt < new Date()) return false;
  const a = Buffer.from(rider.codeHash, "hex");
  const b = Buffer.from(codeDigest(rider._id, String(code || "").replace(/\D/g, "")), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const clearCode = (rider) => {
  rider.codeHash = "";
  rider.codePurpose = "";
  rider.codeExpiresAt = null;
};

/* -------------------------------------------------------------- sessions -- */

const cookieOptions = (maxAge) => ({
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: "lax",
  path: COOKIE_PATH,
  ...(maxAge ? { maxAge } : {}),
});

/** Sign `rider` in on this device. Remember: 30 days; otherwise 12 hours and gone with the browser. */
const startSession = async (rider, req, res, { remember = true } = {}) => {
  const ms = remember ? REMEMBER_MS : SHORT_MS;
  const now = new Date();
  rider.sessions.push({
    expiresAt: new Date(now.getTime() + ms),
    ip: String(req.ip || "").slice(0, 64),
    userAgent: String(req.get?.("user-agent") || "").slice(0, 300),
  });
  rider.sessions = rider.sessions.filter((s) => !s.revokedAt && s.expiresAt > now).slice(-MAX_SESSIONS);
  rider.lastSeenAt = now;
  await rider.save();
  const session = rider.sessions[rider.sessions.length - 1];
  const token = jwt.sign({ typ: "rider", rid: String(rider._id), sid: String(session._id) }, secret(), {
    algorithm: "HS256",
    expiresIn: Math.floor(ms / 1000),
  });
  res.cookie(COOKIE, token, cookieOptions(remember ? ms : 0));
  return session;
};

const clearCookie = (res) => res.clearCookie(COOKIE, cookieOptions(0));

/** The rider and session a cookie value names, or null. Deactivated riders have no session. */
const riderFromToken = async (token) => {
  if (!token || typeof token !== "string") return null;
  let claims;
  try {
    claims = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  if (claims?.typ !== "rider" || !isId(claims.rid) || !claims.sid) return null;
  const rider = await Rider.findById(claims.rid);
  if (!rider || rider.status === "deactivated") return null;
  const session = rider.sessions.id(claims.sid);
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  return { rider, session };
};

/** Express guard: any signed-in rider (pending and suspended ones too, to see why). */
const requireRider = async (req, res, next) => {
  try {
    const found = await riderFromToken(req.cookies?.[COOKIE]);
    if (!found) return next(fail(401, "Please sign in again.", "RIDER_SIGNED_OUT"));
    const { rider, session } = found;
    // Last seen, at most once a minute.
    if (!session.lastActiveAt || Date.now() - new Date(session.lastActiveAt).getTime() > 60_000) {
      session.lastActiveAt = new Date();
      rider.lastSeenAt = new Date();
      await rider.save().catch(() => {});
    }
    req.rider = rider;
    req.riderSession = session;
    next();
  } catch (err) {
    next(err);
  }
};

/** Express guard: only an active rider may go online or touch a delivery. */
const requireActiveRider = (req, res, next) => {
  const status = req.rider?.status;
  if (status === "active") return next();
  if (status === "suspended") return next(fail(403, "Your account is suspended. Please contact your store.", "RIDER_SUSPENDED"));
  return next(fail(403, "Your store hasn't approved your account yet.", "RIDER_PENDING"));
};

/** Sign every device out (suspend, deactivate, PIN reset): sessions revoked, sockets told. */
const revokeAllSessions = (rider) => {
  const now = new Date();
  rider.sessions.forEach((s) => {
    if (!s.revokedAt) s.revokedAt = now;
  });
};

/* ------------------------------------------------------------------ push -- */

/** Push to every device of a rider. Never throws; gone devices are removed. */
const pushToRider = async (riderId, { title, body, url = "/rider/", tag = "" }) => {
  try {
    const subs = await RiderPushSubscription.find({ riderId }).lean();
    if (!subs.length) return { sent: 0 };
    const keys = await require("./csdPush").getKeys();
    const payload = JSON.stringify({ title: clip(title, 80), body: clip(body, 180), url: String(url).slice(0, 300), tag: clip(tag, 80) });
    const options = {
      vapidDetails: { subject: process.env.WEB_PUSH_SUBJECT || "mailto:support@knotkitchen.com", publicKey: keys.publicKey, privateKey: keys.privateKey },
      // A delivery offer is stale within the hour.
      TTL: 60 * 60,
      urgency: "high",
      timeout: 10000,
    };
    let sent = 0;
    const gone = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, options);
          sent += 1;
        } catch (err) {
          if (err?.statusCode === 404 || err?.statusCode === 410) gone.push(s._id);
          else console.warn("[riders] push failed:", err?.statusCode || "", String(err?.body || err?.message || "").slice(0, 200));
        }
      }),
    );
    if (gone.length) await RiderPushSubscription.deleteMany({ _id: { $in: gone } });
    if (sent) await RiderPushSubscription.updateMany({ riderId, _id: { $nin: gone } }, { $set: { lastSentAt: new Date() } });
    return { sent };
  } catch (err) {
    console.warn("[riders] push error:", err.message);
    return { sent: 0 };
  }
};

/* ----------------------------------------------------------------- views -- */

const storeNames = new Map();
/** The store's name, phone and pin for the Rider app, cached for a few minutes. */
const storeInfo = async (restaurantId) => {
  const key = String(restaurantId || "");
  const hit = storeNames.get(key);
  if (hit && hit.at > Date.now() - 5 * 60 * 1000) return hit.value;
  const [r, owner] = key
    ? await Promise.all([
        Restaurant.findById(key).select("name address").lean(),
        require("../models/userModel").findOne({ restaurantId: key, role: "Owner", isDeleted: { $ne: true } }).select("phone").lean(),
      ])
    : [null, null];
  const ad = r?.address || {};
  const value = {
    name: r?.name || "",
    // The store's phone for "Call store": its owner's number.
    phone: owner?.phone || "",
    address: [ad.line1, ad.line2, ad.city].filter(Boolean).join(", "),
    lat: Number.isFinite(ad.lat) ? ad.lat : null,
    lng: Number.isFinite(ad.lng) ? ad.lng : null,
  };
  storeNames.set(key, { at: Date.now(), value });
  return value;
};

/** The rider's own account, as the app shows it. */
const profileView = async (rider) => {
  const store = await storeInfo(rider.restaurantId);
  return {
    id: String(rider._id),
    name: rider.name,
    phone: rider.phone,
    storeId: rider.storeId,
    storeName: store.name,
    status: rider.status,
    statusNote: rider.statusNote || "",
    online: Boolean(rider.online),
    joinedAt: rider.createdAt,
    prefs: { sound: rider.prefs?.sound !== false, vibration: rider.prefs?.vibration !== false },
  };
};

/** Where a rider sees the delivery stand, from the order: the store's stage and the rider's. */
const stageOf = (order) => {
  const d = order.delivery || {};
  if (isCancelled(order.orderStatus) || isRefunded(order.orderStatus) || d.status === "cancelled") return "cancelled";
  if (d.status === "delivered") return "delivered";
  return d.status || "";
};

const addressText = (a = {}) => [a.line2, a.line1, a.city, a.postalCode].map((x) => clip(x, 120)).filter(Boolean).join(", ");

/** Google Maps directions to the customer: their exact point when known, else the address. */
const navUrl = (a = {}) => {
  const dest = Number.isFinite(a.lat) && Number.isFinite(a.lng) ? `${a.lat},${a.lng}` : addressText(a) || "";
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving` : "";
};

/** How much the rider collects at the door: 0 when it was paid online or at the till. */
const toCollect = (order) => {
  if (wasPaid(order)) return 0;
  return Math.round(((Number(order.bills?.totalWithTax) || 0) + (Number(order.bills?.platformFee) || 0)) * 100) / 100;
};

/**
 * One delivery, for the rider who has it. The customer's phone and exact
 * address only while the delivery is under way; afterwards, the name and
 * area, and the phone masked.
 */
const deliveryView = (order, { store } = {}) => {
  const d = order.delivery || {};
  const stage = stageOf(order);
  const live = OPEN.includes(stage);
  const a = order.deliveryAddress || {};
  const customerAddress = {
    line1: clip(a.line1 || order.customerDetails?.address, 200),
    line2: clip(a.line2, 200),
    city: clip(a.city || order.customerDetails?.city, 80),
    postalCode: clip(a.postalCode || order.customerDetails?.pinCode, 10),
  };
  const phone = String(order.customerDetails?.phone || "");
  const ready = READY_STATUSES.includes(String(order.orderStatus)) || OUT_FOR_DELIVERY_STATUSES.includes(String(order.orderStatus)) || isSettled(order.orderStatus);
  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber || "",
    stage,
    foodReady: ready,
    orderStatus: canonicalStatus(order.orderStatus),
    placedAt: order.createdAt,
    customer: {
      name: clip(order.customerDetails?.name, 60) || "Customer",
      phoneMasked: maskPhone(phone),
      ...(live && phone ? { phone } : {}),
    },
    address: live
      ? {
          ...customerAddress,
          instructions: clip(a.instructions || order.customerDetails?.deliveryNote, 200),
          lat: Number.isFinite(a.lat) ? a.lat : null,
          lng: Number.isFinite(a.lng) ? a.lng : null,
          text: addressText(customerAddress),
          navUrl: navUrl({ ...customerAddress, lat: a.lat, lng: a.lng }),
        }
      : { text: [customerAddress.city, customerAddress.postalCode].filter(Boolean).join(" ") || "" },
    distanceKm: Number.isFinite(a.distanceKm) ? Math.round(a.distanceKm * 10) / 10 : null,
    items: (order.items || [])
      .filter((i) => i.status !== "cancelled")
      .map((i) => ({
        name: clip(i.name, 80),
        quantity: i.quantity,
        variant: clip(i.variant?.name, 40),
        extras: [...(i.addons || []).map((x) => x.name), ...(i.modifierSelections || []).map((m) => m.optionName)].filter(Boolean).slice(0, 8),
        note: clip(i.note, 120),
      })),
    bills: {
      subtotal: Number(order.bills?.subtotal) || 0,
      tax: Number(order.bills?.tax) || 0,
      deliveryFee: Number(order.bills?.deliveryFee) || 0,
      packagingFee: Number(order.bills?.packagingFee) || 0,
      discount: Number(order.bills?.discount) || 0,
      platformFee: Number(order.bills?.platformFee) || 0,
      total: Math.round(((Number(order.bills?.totalWithTax) || 0) + (Number(order.bills?.platformFee) || 0)) * 100) / 100,
    },
    collect: live ? toCollect(order) : 0,
    // The customer's handover code is needed to mark it delivered (never the code itself).
    codeRequired: Boolean(order.deliveryCode),
    codeLocked: (d.codeTries || 0) >= 5,
    paidOnline: wasPaid(order),
    times: {
      assignedAt: d.assignedAt || null,
      acceptedAt: d.acceptedAt || null,
      startedAt: d.startedAt || null,
      arrivedAt: d.arrivedAt || null,
      deliveredAt: d.deliveredAt || null,
      cancelledAt: d.cancelledAt || null,
    },
    ...(store ? { store } : {}),
  };
};

/** The delivery as the till sees it on the order. */
const posDeliveryView = (order) => {
  const d = order?.delivery;
  if (!d) return null;
  return {
    riderId: d.riderId ? String(d.riderId) : null,
    riderName: d.riderName || "",
    status: d.status || "",
    assignedAt: d.assignedAt || null,
    acceptedAt: d.acceptedAt || null,
    startedAt: d.startedAt || null,
    arrivedAt: d.arrivedAt || null,
    deliveredAt: d.deliveredAt || null,
    skippedAt: d.skippedAt || null,
    lastRejection: d.rejections?.length ? d.rejections[d.rejections.length - 1] : null,
  };
};

/** For the customer (Knot Eats and the website's tracking page): the rider's first name and stage. */
const customerRiderView = (order) => {
  const d = order?.delivery;
  if (!d?.riderId || !OPEN.concat("delivered").includes(d.status)) return null;
  return { name: clip(String(d.riderName || "").split(/\s+/)[0], 30) || "Your rider", stage: d.status };
};

/* ---------------------------------------------------------------- events -- */

/** Tell the till(s) and the rider that a delivery moved. */
const announce = (order, riderIds = []) => {
  const socket = require("./socket");
  const payload = { orderId: String(order._id), orderNumber: order.orderNumber || "", delivery: posDeliveryView(order) };
  if (order.restaurantId) socket.emitToRestaurant(String(order.restaurantId), "delivery:updated", payload);
  const ids = new Set([...riderIds, order.delivery?.riderId].filter(Boolean).map(String));
  ids.forEach((id) => socket.emitToRider(id, "delivery:updated", { orderId: String(order._id) }));
};

/** A rider's availability changed: every till of the store refreshes its rider list. */
const announceRider = (rider) => {
  if (rider?.restaurantId) {
    require("./socket").emitToRestaurant(String(rider.restaurantId), "rider:updated", { riderId: String(rider._id) });
  }
};

const money = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/* ----------------------------------------------------------- till: assign -- */

/** Riders of a store for the Assign Rider list: active ones, with what each has on. */
const ridersForStore = async (storeId, { all = false } = {}) => {
  const riders = await Rider.find({ storeId, ...(all ? {} : { status: "active" }) })
    .select("name phone status online onlineAt lastSeenAt createdAt approvedAt statusNote")
    .sort({ status: 1, name: 1 })
    .lean();
  if (!riders.length) return [];
  const busy = await Order.aggregate([
    { $match: { "delivery.riderId": { $in: riders.map((r) => r._id) }, "delivery.status": { $in: OPEN }, isDeleted: { $ne: true } } },
    { $group: { _id: "$delivery.riderId", count: { $sum: 1 }, orders: { $push: { n: "$orderNumber", s: "$delivery.status" } } } },
  ]);
  const byId = new Map(busy.map((b) => [String(b._id), b]));
  return riders.map((r) => {
    const b = byId.get(String(r._id));
    return {
      id: String(r._id),
      name: r.name,
      phone: r.phone,
      phoneMasked: maskPhone(r.phone),
      status: r.status,
      statusNote: r.statusNote || "",
      online: Boolean(r.online) && r.status === "active",
      lastSeenAt: r.lastSeenAt || null,
      joinedAt: r.createdAt,
      activeCount: b?.count || 0,
      activeOrders: (b?.orders || []).slice(0, 5).map((o) => ({ orderNumber: o.n, status: o.s })),
      // Only an active, online rider can be given a delivery.
      eligible: r.status === "active" && Boolean(r.online),
    };
  });
};

const orderForStore = async (user, orderId) => {
  if (!isId(orderId)) throw fail(404, "Order not found.");
  const order = await Order.findOne({ _id: orderId, restaurantId: user.restaurantId, isDeleted: { $ne: true } });
  if (!order) throw fail(404, "Order not found.");
  if (String(order.orderType) !== "delivery") throw fail(400, "Only delivery orders can be given to a rider.", "NOT_DELIVERY");
  return order;
};

/** The till gives an order to a rider. Replaces a rider who hasn't accepted yet. */
const assignRider = async ({ user, orderId, riderId }) => {
  const order = await orderForStore(user, orderId);
  if (!isId(riderId)) throw fail(400, "Choose a rider.");
  const rider = await Rider.findOne({ _id: riderId, storeId: String(user.storeId), restaurantId: user.restaurantId });
  if (!rider) throw fail(404, "That rider isn't registered with this store.", "RIDER_NOT_FOUND");
  if (rider.status !== "active") throw fail(409, `${rider.name} isn't active. Approve or reactivate them in Settings > Delivery Riders.`, "RIDER_NOT_ACTIVE");
  if (!rider.online) throw fail(409, `${rider.name} is offline. Ask them to go online in the Rider app.`, "RIDER_OFFLINE");
  if (!ASSIGNABLE_STATUSES.includes(String(order.orderStatus))) {
    throw fail(409, isCancelled(order.orderStatus) ? "This order was cancelled." : "This order can't be given to a rider now.", "NOT_ASSIGNABLE");
  }
  const previous = order.delivery?.riderId && order.delivery.status === "assigned" ? String(order.delivery.riderId) : "";
  if (previous === String(rider._id)) return order;

  const now = new Date();
  // One write that only lands while the order has no rider working on it.
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      orderStatus: { $in: ASSIGNABLE_STATUSES },
      // null also matches a delivery with no status yet: one only "Assign later" (skippedAt) has touched.
      $or: [{ delivery: { $exists: false } }, { delivery: null }, { "delivery.status": { $in: [null, "", "assigned", "cancelled"] } }],
    },
    {
      $set: {
        "delivery.riderId": rider._id,
        "delivery.riderName": rider.name,
        "delivery.status": "assigned",
        "delivery.assignedAt": now,
        "delivery.assignedBy": clip(user.name || "POS", 60),
        "delivery.acceptedAt": null,
        "delivery.startedAt": null,
        "delivery.arrivedAt": null,
        "delivery.deliveredAt": null,
        "delivery.cancelledAt": null,
        // A new rider starts with a clean count of delivery-code tries.
        "delivery.codeTries": 0,
        // The rider closes it: the auto-complete timer must not mark it Delivered on the way.
        completeDueAt: null,
      },
    },
    { new: true },
  );
  if (!updated) throw fail(409, "Another rider already has this delivery. Refresh the order.", "ALREADY_ASSIGNED");

  announce(updated, previous ? [previous] : []);
  if (previous) {
    pushToRider(previous, { title: "Delivery reassigned", body: `Order #${updated.orderNumber} was given to another rider.`, url: "/rider/", tag: `order-${updated._id}` });
  }
  const a = updated.deliveryAddress || {};
  pushToRider(rider._id, {
    title: "New Delivery Assigned 🚴",
    body: [`Order #${updated.orderNumber}`, clip(updated.customerDetails?.name, 40), clip(a.line1 || updated.customerDetails?.address, 60), money(toCollect(updated) || updated.bills?.totalWithTax)].filter(Boolean).join(" · "),
    url: `/rider/delivery/${updated._id}`,
    tag: `order-${updated._id}`,
  });
  return updated;
};

/** The till takes a rider off an order (before it is delivered). */
const unassignRider = async ({ user, orderId }) => {
  const order = await orderForStore(user, orderId);
  const riderId = order.delivery?.riderId ? String(order.delivery.riderId) : "";
  if (!riderId || !OPEN.includes(order.delivery.status)) throw fail(409, "No rider is on this order.", "NO_RIDER");
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, "delivery.riderId": order.delivery.riderId, "delivery.status": { $in: OPEN } },
    { $set: { "delivery.riderId": null, "delivery.riderName": "", "delivery.status": "" } },
    { new: true },
  );
  if (!updated) throw fail(409, "The rider just moved this delivery on. Refresh the order.", "CHANGED");
  announce(updated, [riderId]);
  pushToRider(riderId, { title: "Delivery removed", body: `Order #${updated.orderNumber} was taken off you by the store.`, url: "/rider/", tag: `order-${updated._id}` });
  return updated;
};

/** "Assign later" at Ready: remembered so the till doesn't ask again. */
const skipAssign = async ({ user, orderId }) => {
  const order = await orderForStore(user, orderId);
  if (order.delivery?.riderId && OPEN.includes(order.delivery.status)) return order;
  const updated = await Order.findOneAndUpdate({ _id: order._id }, { $set: { "delivery.skippedAt": new Date() } }, { new: true });
  announce(updated);
  return updated;
};

/* ----------------------------------------------------------- rider: steps -- */

/** A rider's own delivery, or 404: another rider's, another store's or an unassigned one are not theirs. */
const riderOrder = async (rider, orderId) => {
  if (!isId(orderId)) throw fail(404, "Delivery not found.");
  const order = await Order.findOne({ _id: orderId, storeId: rider.storeId, "delivery.riderId": rider._id, isDeleted: { $ne: true } });
  if (!order) throw fail(404, "This delivery isn't assigned to you any more.", "NOT_YOURS");
  return order;
};

/**
 * Move a rider's delivery from one of `from` to `to`, in one conditional
 * write. Refuses when the order was cancelled or the delivery moved on.
 */
const step = async (rider, orderId, from, to, extra = {}, orderFilter = {}) => {
  const order = await riderOrder(rider, orderId);
  if (stageOf(order) === "cancelled") throw fail(409, "This order was cancelled. Don't deliver it.", "ORDER_CANCELLED");
  if (!from.includes(order.delivery.status)) {
    throw fail(409, order.delivery.status === to ? "Already done." : "This delivery has moved on. Refresh.", "WRONG_STAGE");
  }
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, "delivery.riderId": rider._id, "delivery.status": { $in: from }, orderStatus: { $nin: [...CANCELLED_STATUSES, ...REFUNDED_STATUSES] }, ...orderFilter },
    { $set: { "delivery.status": to, ...extra } },
    { new: true },
  );
  if (!updated) throw fail(409, "This delivery changed just now. Refresh.", "CHANGED");
  return updated;
};

const acceptDelivery = async (rider, orderId) => {
  const updated = await step(rider, orderId, ["assigned"], "accepted", { "delivery.acceptedAt": new Date() });
  announce(updated);
  return updated;
};

const rejectDelivery = async (rider, orderId, { reason, note } = {}) => {
  const why = REJECT_REASONS.includes(reason) ? reason : "";
  if (!why) throw fail(400, "Choose why you can't take it.", "REASON_REQUIRED");
  if (why === "Other" && !clip(note, 200)) throw fail(400, "Tell the store why.", "NOTE_REQUIRED");
  const order = await riderOrder(rider, orderId);
  if (!["assigned", "accepted"].includes(order.delivery.status)) throw fail(409, "You've already set off with this one. Call the store.", "WRONG_STAGE");
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, "delivery.riderId": rider._id, "delivery.status": { $in: ["assigned", "accepted"] } },
    {
      $set: { "delivery.riderId": null, "delivery.riderName": "", "delivery.status": "" },
      $push: { "delivery.rejections": { riderId: rider._id, riderName: rider.name, reason: why, note: clip(note, 200), at: new Date() } },
    },
    { new: true },
  );
  if (!updated) throw fail(409, "This delivery changed just now. Refresh.", "CHANGED");
  announce(updated, [String(rider._id)]);
  return updated;
};

const startDelivery = async (rider, orderId) => {
  const order = await riderOrder(rider, orderId);
  const ready = READY_STATUSES.includes(String(order.orderStatus)) || OUT_FOR_DELIVERY_STATUSES.includes(String(order.orderStatus));
  if (!ready && stageOf(order) !== "cancelled") throw fail(409, "The restaurant hasn't marked this order ready yet.", "NOT_READY");
  const updated = await step(rider, orderId, ["accepted"], "on_the_way", { "delivery.startedAt": new Date() }, {
    orderStatus: { $in: [...READY_STATUSES, ...OUT_FOR_DELIVERY_STATUSES] },
  });
  if (!OUT_FOR_DELIVERY_STATUSES.includes(String(updated.orderStatus))) {
    await require("../controllers/orderController").setDeliveryOrderStatus(updated, OUT_FOR_DELIVERY, `Rider: ${rider.name}`);
  }
  announce(updated);
  return updated;
};

const arriveDelivery = async (rider, orderId) => {
  const updated = await step(rider, orderId, ["on_the_way"], "arrived", { "delivery.arrivedAt": new Date() });
  announce(updated);
  return updated;
};

const MAX_CODE_TRIES = 5;

const completeDelivery = async (rider, orderId, { collected, code } = {}) => {
  const order = await riderOrder(rider, orderId);
  // A website or Knot Eats delivery: the customer's 4-digit code proves the handover.
  if (order.deliveryCode && OPEN.includes(order.delivery?.status)) {
    const tries = order.delivery?.codeTries || 0;
    if (tries >= MAX_CODE_TRIES) throw fail(429, "Too many wrong codes. Call the store: they can mark it delivered.", "CODE_LOCKED");
    const given = String(code ?? "").replace(/D/g, "");
    const a = Buffer.from(given.padEnd(4, "x"));
    const b = Buffer.from(String(order.deliveryCode));
    if (!(a.length === b.length && crypto.timingSafeEqual(a, b))) {
      if (!given) throw fail(400, "Ask the customer for their 4-digit delivery code.", "CODE_REQUIRED");
      const after = await Order.findOneAndUpdate({ _id: order._id, "delivery.riderId": rider._id }, { $inc: { "delivery.codeTries": 1 } }, { new: true });
      const left = MAX_CODE_TRIES - (after?.delivery?.codeTries || tries + 1);
      throw left > 0
        ? fail(400, `That code isn't right. ${left} tr${left === 1 ? "y" : "ies"} left.`, "WRONG_CODE")
        : fail(429, "Too many wrong codes. Call the store: they can mark it delivered.", "CODE_LOCKED");
    }
  }
  const due = toCollect(order);
  if (due > 0 && collected !== true) throw fail(400, `Collect ${money(due)} from the customer first, then confirm.`, "CONFIRM_CASH");
  const updated = await step(rider, orderId, ["on_the_way", "arrived"], "delivered", { "delivery.deliveredAt": new Date() });
  if (!isSettled(updated.orderStatus)) {
    await require("../controllers/orderController").setDeliveryOrderStatus(updated, DELIVERED, `Rider: ${rider.name}`);
  }
  announce(updated);
  return updated;
};

/**
 * After any order status change (services/socket emitOrderStatusChanged):
 * keep the rider's delivery in step with what the till or the system did.
 * Each update is conditional, so this runs safely after the rider's own steps.
 */
const afterOrderStatus = async (order) => {
  const d = order?.delivery;
  if (!d?.riderId || !OPEN.includes(d.status)) return;
  const riderId = String(d.riderId);
  if (isCancelled(order.orderStatus) || isRefunded(order.orderStatus)) {
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, "delivery.riderId": d.riderId, "delivery.status": { $in: OPEN } },
      { $set: { "delivery.status": "cancelled", "delivery.cancelledAt": new Date() } },
      { new: true },
    );
    if (!updated) return;
    announce(updated);
    pushToRider(riderId, { title: "Order cancelled ✖", body: `Order #${updated.orderNumber} was cancelled. Don't deliver it; return it to the store if you have it.`, url: `/rider/delivery/${updated._id}`, tag: `order-${updated._id}` });
    return;
  }
  if (isSettled(order.orderStatus)) {
    // The till marked it Delivered (or done) itself.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, "delivery.riderId": d.riderId, "delivery.status": { $in: OPEN } },
      { $set: { "delivery.status": "delivered", "delivery.deliveredAt": new Date() } },
      { new: true },
    );
    if (updated) announce(updated);
    return;
  }
  if (canonicalStatus(order.orderStatus) === OUT_FOR_DELIVERY && ["assigned", "accepted"].includes(d.status)) {
    // The till pressed Out for delivery: the rider has it.
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, "delivery.riderId": d.riderId, "delivery.status": { $in: ["assigned", "accepted"] } },
      { $set: { "delivery.status": "on_the_way", "delivery.startedAt": new Date(), ...(d.acceptedAt ? {} : { "delivery.acceptedAt": new Date() }) } },
      { new: true },
    );
    if (updated) announce(updated);
  }
};

/**
 * A rider their old store removed, joining another: a fresh start there.
 * Their PIN, sessions and devices go; the new store approves them (or they
 * use its invite code). Deliveries stay on the old store's orders.
 */
const moveToStore = (rider, { storeId, restaurantId }) => {
  rider.storeId = String(storeId);
  rider.restaurantId = restaurantId;
  rider.pinHash = "";
  rider.status = "pending";
  rider.statusNote = "";
  rider.approvedAt = null;
  rider.approvedBy = "";
  rider.online = false;
  clearCode(rider);
  revokeAllSessions(rider);
  RiderPushSubscription.deleteMany({ riderId: rider._id }).catch(() => {});
};

/** A rider who is suspended, deactivated or goes offline keeps what they have; a deactivated one hands back. */
const releaseOpenDeliveries = async (rider) => {
  const open = await Order.find({ "delivery.riderId": rider._id, "delivery.status": { $in: ["assigned", "accepted"] } }).select("_id").lean();
  for (const o of open) {
    const updated = await Order.findOneAndUpdate(
      { _id: o._id, "delivery.riderId": rider._id, "delivery.status": { $in: ["assigned", "accepted"] } },
      { $set: { "delivery.riderId": null, "delivery.riderName": "", "delivery.status": "" } },
      { new: true },
    );
    if (updated) announce(updated, [String(rider._id)]);
  }
  return open.length;
};

module.exports = {
  COOKIE,
  OPEN,
  REJECT_REASONS,
  ASSIGNABLE_STATUSES,
  cleanPhone,
  pinProblem,
  hashPin,
  maskPhone,
  issueCode,
  codeMatches,
  clearCode,
  startSession,
  clearCookie,
  riderFromToken,
  requireRider,
  requireActiveRider,
  revokeAllSessions,
  pushToRider,
  storeInfo,
  profileView,
  stageOf,
  deliveryView,
  posDeliveryView,
  customerRiderView,
  announce,
  announceRider,
  ridersForStore,
  assignRider,
  unassignRider,
  skipAssign,
  riderOrder,
  acceptDelivery,
  rejectDelivery,
  startDelivery,
  arriveDelivery,
  completeDelivery,
  afterOrderStatus,
  releaseOpenDeliveries,
  moveToStore,
  LOCK_MS,
  MAX_FAILED_PINS,
};
