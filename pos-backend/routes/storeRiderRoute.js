const express = require("express");
const createHttpError = require("http-errors");
const { isVerifiedUser } = require("../middlewares/tokenVerification");
const { requireManager } = require("../middlewares/requirePermission");
const { logActivity } = require("../services/auditService");
const Order = require("../models/orderModel");
const { Rider, RiderPushSubscription } = require("../models/riderModel");
const riders = require("../services/riders");

/**
 * The store's delivery riders, from the POS (/api/riders).
 *
 *   Any signed-in till:  the rider list, assign / unassign / assign later.
 *   Owner or manager:    add (invite), approve, suspend, reactivate, remove,
 *                        reset a PIN, a rider's history.
 *
 * Always the till's own store: a rider id of another store is a 404.
 */
const router = express.Router();
router.use(isVerifiedUser);

const ok = (res, data = {}) => res.status(200).json({ success: true, data });
const fail = (status, message, code) => createHttpError(status, message, code ? { code } : undefined);

const storeOf = (req) => {
  const storeId = String(req.user?.storeId || "");
  if (!/^\d{6}$/.test(storeId) || !req.user?.restaurantId) throw fail(409, "This login isn't set up for a store.");
  return storeId;
};

// logActivity never throws (it logs its own failures).
const audit = (req, action, rider, extra = {}) =>
  logActivity({
    req,
    action,
    resource: "Rider",
    entityType: "Rider",
    entityId: rider?._id,
    description: `${rider?.name || "Rider"} (${riders.maskPhone(rider?.phone)})${extra.released ? `: ${extra.released} delivery(s) back to the till` : ""}`,
  });

const findRider = async (req) => {
  const storeId = storeOf(req);
  const id = String(req.params.id || "");
  if (!/^[a-f0-9]{24}$/i.test(id)) throw fail(404, "Rider not found.");
  const rider = await Rider.findOne({ _id: id, storeId, restaurantId: req.user.restaurantId });
  if (!rider) throw fail(404, "Rider not found.");
  return rider;
};

/* ------------------------------------------------------------ the list -- */

// GET /api/riders?all=1 -- active riders (for Assign); all=1 every rider (managers).
router.get("/", async (req, res, next) => {
  try {
    const storeId = storeOf(req);
    const all = req.query.all === "1";
    if (all) await new Promise((resolve, reject) => requireManager(req, res, (e) => (e ? reject(e) : resolve())));
    res.set("Cache-Control", "no-store");
    ok(res, { riders: await riders.ridersForStore(storeId, { all }) });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------- the deliveries -- */

const deliveryResult = (order) => ({ orderId: String(order._id), delivery: riders.posDeliveryView(order) });

// POST /api/riders/orders/:orderId/assign { riderId }
router.post("/orders/:orderId/assign", async (req, res, next) => {
  try {
    storeOf(req);
    const order = await riders.assignRider({ user: req.user, orderId: req.params.orderId, riderId: req.body?.riderId });
    ok(res, deliveryResult(order));
  } catch (err) {
    next(err);
  }
});

// POST /api/riders/orders/:orderId/unassign
router.post("/orders/:orderId/unassign", async (req, res, next) => {
  try {
    storeOf(req);
    ok(res, deliveryResult(await riders.unassignRider({ user: req.user, orderId: req.params.orderId })));
  } catch (err) {
    next(err);
  }
});

// POST /api/riders/orders/:orderId/skip -- "Assign later"
router.post("/orders/:orderId/skip", async (req, res, next) => {
  try {
    storeOf(req);
    ok(res, deliveryResult(await riders.skipAssign({ user: req.user, orderId: req.params.orderId })));
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------- managing riders -- */

router.use(requireManager);

// POST /api/riders { name, phone } -- invite: a code the rider signs up with, and they are in at once.
router.post("/", async (req, res, next) => {
  try {
    const storeId = storeOf(req);
    const phone = riders.cleanPhone(req.body?.phone);
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (name.length < 2) throw fail(400, "Enter the rider's name.");
    if (!phone) throw fail(400, "Enter a valid 10-digit mobile number.");
    let rider = await Rider.findOne({ phone });
    if (rider && rider.storeId !== storeId) {
      if (rider.status !== "deactivated") throw fail(409, "This number is registered with another store.", "OTHER_STORE");
      // Removed by their old store: this store can take them on.
      riders.moveToStore(rider, { storeId, restaurantId: req.user.restaurantId });
    }
    if (rider && rider.pinHash && rider.status !== "deactivated") {
      throw fail(409, `${rider.name} is already registered with this store. ${rider.status === "pending" ? "Approve them below." : ""}`.trim(), "EXISTS");
    }
    if (!rider) rider = new Rider({ storeId, restaurantId: req.user.restaurantId, phone, name, status: "pending" });
    rider.name = name;
    const code = riders.issueCode(rider, "invite");
    await rider.save();
    audit(req, "RIDER_INVITED", rider);
    riders.announceRider(rider);
    ok(res, { rider: { id: String(rider._id), name: rider.name, phone: rider.phone }, code, expiresAt: rider.codeExpiresAt });
  } catch (err) {
    if (err?.code === 11000) return next(fail(409, "This number is already registered."));
    next(err);
  }
});

// GET /api/riders/:id -- one rider: profile and how they've done.
router.get("/:id", async (req, res, next) => {
  try {
    const rider = await findRider(req);
    const since = new Date(Date.now() - 30 * 864e5);
    const [delivered30, total, open] = await Promise.all([
      Order.countDocuments({ "delivery.riderId": rider._id, "delivery.status": "delivered", "delivery.deliveredAt": { $gte: since } }),
      Order.countDocuments({ "delivery.riderId": rider._id, "delivery.status": "delivered" }),
      Order.find({ "delivery.riderId": rider._id, "delivery.status": { $in: riders.OPEN } }).select("orderNumber delivery.status").lean(),
    ]);
    res.set("Cache-Control", "no-store");
    ok(res, {
      rider: {
        id: String(rider._id),
        name: rider.name,
        phone: rider.phone,
        status: rider.status,
        statusNote: rider.statusNote || "",
        online: Boolean(rider.online) && rider.status === "active",
        joinedAt: rider.createdAt,
        approvedAt: rider.approvedAt,
        lastSeenAt: rider.lastSeenAt,
        hasPin: Boolean(rider.pinHash),
        pendingCode: rider.codePurpose && rider.codeExpiresAt > new Date() ? rider.codePurpose : "",
      },
      stats: { delivered30, total, open: open.map((o) => ({ orderNumber: o.orderNumber, status: o.delivery.status })) },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/riders/:id/deliveries?days=7|30|90
router.get("/:id/deliveries", async (req, res, next) => {
  try {
    const rider = await findRider(req);
    const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const orders = await Order.find({
      "delivery.riderId": rider._id,
      "delivery.assignedAt": { $gte: new Date(Date.now() - days * 864e5) },
      isDeleted: { $ne: true },
    })
      .sort({ "delivery.assignedAt": -1 })
      .limit(300)
      .select("orderNumber orderStatus customerDetails.name deliveryAddress.line1 deliveryAddress.city bills delivery createdAt")
      .lean();
    ok(res, {
      deliveries: orders.map((o) => ({
        orderId: String(o._id),
        orderNumber: o.orderNumber,
        customer: o.customerDetails?.name || "",
        area: [o.deliveryAddress?.line1, o.deliveryAddress?.city].filter(Boolean).join(", ").slice(0, 80),
        total: Math.round(((Number(o.bills?.totalWithTax) || 0) + (Number(o.bills?.platformFee) || 0)) * 100) / 100,
        status: o.delivery?.status || "",
        assignedAt: o.delivery?.assignedAt || null,
        deliveredAt: o.delivery?.deliveredAt || null,
        minutes:
          o.delivery?.deliveredAt && o.delivery?.startedAt
            ? Math.max(1, Math.round((new Date(o.delivery.deliveredAt) - new Date(o.delivery.startedAt)) / 60000))
            : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const setStatus = (to, action, { revoke = false, release = false } = {}) => async (req, res, next) => {
  try {
    const rider = await findRider(req);
    if (to === "active" && !rider.pinHash) throw fail(409, "This rider hasn't set a PIN yet. Share the invite code with them.", "NO_PIN");
    rider.status = to;
    rider.statusNote = to === "suspended" ? String(req.body?.note || "").trim().slice(0, 200) : "";
    if (to === "active" && !rider.approvedAt) {
      rider.approvedAt = new Date();
      rider.approvedBy = String(req.user.name || "Owner").slice(0, 60);
    }
    if (to !== "active") rider.online = false;
    if (revoke) riders.revokeAllSessions(rider);
    await rider.save();
    if (revoke) require("../services/socket").disconnectRider(String(rider._id));
    if (to === "deactivated") await RiderPushSubscription.deleteMany({ riderId: rider._id });
    const released = release ? await riders.releaseOpenDeliveries(rider) : 0;
    audit(req, action, rider, released ? { released } : {});
    riders.announceRider(rider);
    if (to === "active") {
      riders.pushToRider(rider._id, { title: "You're approved ✅", body: "Go online in the Rider app to start getting deliveries.", url: "/rider/", tag: "account" });
    } else if (to === "suspended") {
      riders.pushToRider(rider._id, { title: "Account suspended", body: "Your store has paused your deliveries. Contact them for details.", url: "/rider/", tag: "account" });
    }
    require("../services/socket").emitToRider(String(rider._id), "rider:account", { status: to });
    ok(res, { status: rider.status, released });
  } catch (err) {
    next(err);
  }
};

router.post("/:id/approve", setStatus("active", "RIDER_APPROVED"));
router.post("/:id/reactivate", setStatus("active", "RIDER_REACTIVATED"));
// Suspended: can still sign in and see why; anything not yet on the road goes back to the till.
router.post("/:id/suspend", setStatus("suspended", "RIDER_SUSPENDED", { release: true }));
// Removed: signed out everywhere, notifications off, deliveries not yet on the road back to the till.
router.post("/:id/deactivate", setStatus("deactivated", "RIDER_DEACTIVATED", { revoke: true, release: true }));

// POST /api/riders/:id/reset-pin -- a 30-minute code the rider uses on Forgot PIN.
router.post("/:id/reset-pin", async (req, res, next) => {
  try {
    const rider = await findRider(req);
    if (rider.status === "deactivated") throw fail(409, "Reactivate this rider first.");
    const purpose = rider.pinHash ? "reset" : "invite";
    const code = riders.issueCode(rider, purpose);
    await rider.save();
    audit(req, purpose === "reset" ? "RIDER_PIN_RESET_CODE" : "RIDER_INVITED", rider);
    ok(res, { code, purpose, expiresAt: rider.codeExpiresAt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
