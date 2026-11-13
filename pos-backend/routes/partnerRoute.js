const express = require("express");
const createHttpError = require("http-errors");
const config = require("../config/config");
const { rateLimit, clientIp } = require("../middlewares/rateLimiter");
const { verifyStoreCredentials } = require("../controllers/userController");
const { reportFor } = require("../controllers/orderController");
const { PartnerAccount, PartnerLink } = require("../models/partnerModel");
const { localDate, DEFAULT_TZ } = require("../services/tableBookings");
const { logActivity } = require("../services/auditService");
const {
  isOwnerLogin,
  fingerprintOf,
  startSession,
  clearCookie,
  readSession,
  requirePartner,
  ownerForLink,
  linkFor,
  storeCards,
} = require("../services/partners");
const { aggregateDashboard } = require("../services/partnerDashboard");

/**
 * The Partners dashboard API (knotkitchen.com/partners -> Caddy ->
 * /api/partners). One owner, any number of stores, each linked with its own
 * Owner login. A store's Billing and Reports go through
 * middlewares/partnerPassthrough (/api/partners/s/<storeId>/api/...).
 */
const router = express.Router();

// Signing in and linking both try a store password: the POS sign-in's limits.
const credentialsLimiter = rateLimit({
  windowMs: config.authLoginRateWindowMs,
  max: config.authLoginRateMax,
  keyGenerator: (req) => `partner-login:${clientIp(req)}:${String(req.body?.storeId || "").slice(0, 12)}`,
  message: "Too many sign-in attempts. Please wait a few minutes and try again.",
});

/** The store's Owner login, or a refusal that says why. Never a staff login. */
const ownerFromCredentials = async (body) => {
  const user = await verifyStoreCredentials(body || {});
  // The password was right: the attempt counter resets either way.
  await user.save();
  if (!isOwnerLogin(user)) {
    throw createHttpError(403, "Only the store's Owner login can be used here. Staff logins cannot.", { code: "NOT_OWNER" });
  }
  if (!user.restaurantId || !/^\d{6}$/.test(String(user.storeId || ""))) {
    throw createHttpError(409, "This login is not set up for a store yet.");
  }
  return user;
};

const meOf = async (partner) => ({
  name: partner.name,
  phone: partner.phone,
  stores: await storeCards(partner),
});

/* ------------------------------------------------------------- sign-in -- */

// POST /api/partners/auth/login { storeId, phone, password }
// Signs into the account that store is linked to; the first time, makes one.
router.post("/auth/login", credentialsLimiter, async (req, res, next) => {
  try {
    const user = await ownerFromCredentials(req.body);
    let link = await PartnerLink.findOne({ storeId: String(user.storeId) });
    let partner = link ? await PartnerAccount.findById(link.partnerId) : null;
    if (!partner) {
      partner = await PartnerAccount.create({ name: user.name || "", phone: user.phone || "", createdByUserId: user._id });
      if (link) await PartnerLink.deleteOne({ _id: link._id }); // its account was gone
      link = await PartnerLink.create({
        partnerId: partner._id,
        storeId: String(user.storeId),
        restaurantId: user.restaurantId,
        userId: user._id,
        fingerprint: fingerprintOf(user),
        linkedFromIp: String(req.ip || "").slice(0, 64),
      });
    } else {
      // Signing in with it confirms the link with today's password.
      link.userId = user._id;
      link.restaurantId = user.restaurantId;
      link.fingerprint = fingerprintOf(user);
      await link.save();
    }
    await startSession(partner, req, res);
    await logActivity({ req, user, action: "Partners sign-in", resource: "Partners", description: `Signed in to the Partners dashboard (store ${user.storeId})` }).catch(() => {});
    res.status(200).json({ success: true, data: await meOf(partner) });
  } catch (err) {
    next(err);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const found = await readSession(req);
    if (found) {
      found.session.revokedAt = new Date();
      await found.partner.save();
    }
    clearCookie(res);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requirePartner, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await meOf(req.partner) });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------ sessions -- */

router.get("/sessions", requirePartner, (req, res) => {
  const now = new Date();
  const list = req.partner.sessions
    .filter((s) => !s.revokedAt && s.expiresAt > now)
    .map((s) => ({
      id: String(s._id),
      current: String(s._id) === String(req.partnerSession._id),
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      userAgent: s.userAgent,
      ip: s.ip,
    }))
    .reverse();
  res.status(200).json({ success: true, data: list });
});

// Sign out every other device.
router.post("/sessions/revoke-others", requirePartner, async (req, res, next) => {
  try {
    const keep = String(req.partnerSession._id);
    let n = 0;
    for (const s of req.partner.sessions) {
      if (String(s._id) !== keep && !s.revokedAt) {
        s.revokedAt = new Date();
        n += 1;
      }
    }
    await req.partner.save();
    res.status(200).json({ success: true, data: { signedOut: n } });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------- stores -- */

router.get("/stores", requirePartner, async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await storeCards(req.partner) });
  } catch (err) {
    next(err);
  }
});

// POST /api/partners/stores { storeId, phone, password }: link a store, or
// confirm one whose password changed.
router.post("/stores", requirePartner, credentialsLimiter, async (req, res, next) => {
  try {
    const user = await ownerFromCredentials(req.body);
    const storeId = String(user.storeId);
    const existing = await PartnerLink.findOne({ storeId });
    if (existing && String(existing.partnerId) !== String(req.partner._id)) {
      const other = await PartnerAccount.exists({ _id: existing.partnerId });
      if (other) {
        throw createHttpError(409, "This store is already linked to another Partners account. Unlink it there first.", { code: "LINKED_ELSEWHERE" });
      }
      await PartnerLink.deleteOne({ _id: existing._id });
    }
    const relinked = Boolean(existing && String(existing.partnerId) === String(req.partner._id));
    await PartnerLink.findOneAndUpdate(
      { storeId },
      {
        partnerId: req.partner._id,
        storeId,
        restaurantId: user.restaurantId,
        userId: user._id,
        fingerprint: fingerprintOf(user),
        ...(relinked ? {} : { linkedAt: new Date(), linkedFromIp: String(req.ip || "").slice(0, 64) }),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    await logActivity({ req, user, action: relinked ? "Partners store confirmed" : "Partners store linked", resource: "Partners", description: `Store ${storeId} ${relinked ? "confirmed" : "linked"} on the Partners dashboard` }).catch(() => {});
    res.status(200).json({ success: true, data: { relinked, stores: await storeCards(req.partner) } });
  } catch (err) {
    next(err);
  }
});

router.delete("/stores/:storeId", requirePartner, async (req, res, next) => {
  try {
    const link = await linkFor(req.partner, req.params.storeId);
    const count = await PartnerLink.countDocuments({ partnerId: req.partner._id });
    if (count <= 1) throw createHttpError(400, "This is your only store. Link another before unlinking it.");
    await PartnerLink.deleteOne({ _id: link._id });
    res.status(200).json({ success: true, data: await storeCards(req.partner) });
  } catch (err) {
    next(err);
  }
});

/* ----------------------------------------------------------- dashboard -- */

/** The stores a request asks for (?stores=a,b), out of the ones linked and usable. */
const pickStores = async (partner, query) => {
  const links = await PartnerLink.find({ partnerId: partner._id }).sort({ linkedAt: 1 });
  const wanted = String(query.stores || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{6}$/.test(s));
  const chosen = wanted.length ? links.filter((l) => wanted.includes(l.storeId)) : links;
  const usable = [];
  const skipped = [];
  for (const link of chosen) {
    try {
      usable.push({ link, owner: await ownerForLink(link) });
    } catch (err) {
      skipped.push({ storeId: link.storeId, code: err.code || "LINK_INVALID", message: err.message });
    }
  }
  return { usable, skipped };
};

const ymd = (d) => localDate(d, DEFAULT_TZ);

// GET /api/partners/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&stores=a,b
router.get("/dashboard", requirePartner, async (req, res, next) => {
  try {
    const { usable, skipped } = await pickStores(req.partner, req.query);
    const cards = await storeCards(req.partner);
    const nameOf = new Map(cards.map((c) => [c.storeId, c.name]));
    const current = await Promise.all(usable.map(({ owner }) => reportFor(owner, req.query)));
    // The same length of time just before, for the change figures.
    let previous = [];
    if (current.length) {
      const { start, end } = current[0].window;
      const span = end.getTime() - start.getTime() + 1;
      const prevQuery = { from: ymd(new Date(start.getTime() - span)), to: ymd(new Date(start.getTime() - 1)) };
      previous = await Promise.all(usable.map(({ owner }) => reportFor(owner, prevQuery)));
    }
    const data = aggregateDashboard({
      stores: usable.map(({ link }, i) => ({ storeId: link.storeId, name: nameOf.get(link.storeId) || link.storeId, report: current[i], previous: previous[i] })),
    });
    res.status(200).json({
      success: true,
      data: {
        ...data,
        window: current[0] ? { from: current[0].window.start, to: current[0].window.end } : null,
        skipped,
        alerts: cards
          .filter((c) => c.locked || c.linkStatus !== "ok" || (c.wallet?.paise ?? 0) < 50000 || (c.plan?.renewsOn && new Date(c.plan.renewsOn) - Date.now() < 3 * 86400000))
          .map((c) => ({
            storeId: c.storeId,
            name: c.name,
            kind: c.linkStatus !== "ok" ? "link" : c.locked ? "locked" : (c.wallet?.paise ?? 0) < 50000 ? "wallet" : "renewal",
            wallet: c.wallet,
            renewsOn: c.plan?.renewsOn || null,
            lockedReason: c.lockedReason,
          })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/orders?from&to&stores=&q= : every chosen store's orders, newest first.
router.get("/orders", requirePartner, async (req, res, next) => {
  try {
    const { usable, skipped } = await pickStores(req.partner, req.query);
    const cards = await storeCards(req.partner);
    const nameOf = new Map(cards.map((c) => [c.storeId, c.name]));
    const reports = await Promise.all(usable.map(({ owner }) => reportFor(owner, req.query)));
    const q = String(req.query.q || "").trim().toLowerCase().slice(0, 60);
    const rows = [];
    reports.forEach((r, i) => {
      const storeId = usable[i].link.storeId;
      for (const o of r.projected) {
        const row = {
          _id: o._id,
          storeId,
          storeName: nameOf.get(storeId) || storeId,
          orderNumber: o.orderNumber,
          orderId: o.orderId,
          createdAt: o.createdAt,
          orderStatus: o.orderStatus,
          orderType: o.orderType,
          source: o.source,
          salesChannel: o.salesChannel,
          paymentMethod: o.paymentMethod,
          customerName: o.customerDetails?.name || "",
          customerPhone: o.customerDetails?.phone || "",
          table: o.table,
          total: o.bills?.totalWithTax ?? o.bills?.total ?? 0,
          items: (o.items || []).length,
        };
        if (q) {
          const hay = `${row.orderNumber || ""} ${row.orderId || ""} ${row.customerName} ${row.customerPhone} ${row.storeName}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        rows.push(row);
      }
    });
    rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json({ success: true, data: { orders: rows.slice(0, 1000), truncated: rows.length > 1000, total: rows.length, skipped } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
