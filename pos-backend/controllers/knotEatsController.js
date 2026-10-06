const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const config = require("../config/config");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
// Required here so the model is registered at boot (app.js -> route -> this),
// which is what lets services/storePurge sweep a deleted store's reviews.
const KnotEatsReview = require("../models/knotEatsReviewModel");
const CsdPosSession = require("../models/csdPosSessionModel");
const knotEats = require("../services/knotEats");
const { mapsUsage } = require("../services/distanceService");
const { readToken } = require("../services/receiptLink");
const { applyPublishedSnapshot } = require("../services/websitePublish");
const { mergedContact } = require("../services/websitePublicInfo");
const { toRupees } = require("../services/money");
const { logActivity } = require("../services/auditService");
const { csdAudit } = require("../services/csdAuditService");
const {
  AWAITING_ACCEPTANCE,
  READY_STATUSES,
  OUT_FOR_DELIVERY,
  canonicalStatus,
  isSettled,
  isCancelled,
  isRefunded,
} = require("../constants/orderStatus");
// Lazy: both load the order/billing stacks; resolved per call.
const storefront = () => require("./storefrontController");
const pricing = () => require("../services/pricing");
const websiteSettings = () => require("./websiteSettingsController");

/**
 * Knot Eats endpoints, three audiences:
 *
 *   public  /api/eats/*                 diners on eats.<base>, unauthenticated
 *   POS     /api/website/knot-eats      the owner's opt-in (tenant from session)
 *   CSD     /api/csd/knot-eats/*        delisting and review moderation
 *
 * Public responses are whitelists built here or in services/knotEats; the
 * tenant only ever comes from the URL, never the body.
 */

const REVIEW_WINDOW_DAYS = 14;
const CSD_PAGE = 25;

const httpError = (status, message, code) => Object.assign(createHttpError(status, message), code ? { code } : {});
const unavailable = () => httpError(404, knotEats.UNAVAILABLE_MESSAGE, "KNOT_EATS_UNAVAILABLE");
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

/* ------------------------------------------------------------------ */
/* Public                                                              */
/* ------------------------------------------------------------------ */

/** GET /api/eats/config */
const getConfig = async (req, res, next) => {
  try {
    res.set("Cache-Control", "public, max-age=300");
    ok(res, await knotEats.publicConfig());
  } catch (error) {
    next(error);
  }
};

/** GET /api/eats/stores */
const listStores = async (req, res, next) => {
  try {
    const data = await knotEats.listStores(req.query);
    res.set("Cache-Control", "private, max-age=30");
    ok(res, data);
  } catch (error) {
    next(error);
  }
};

/** GET /api/eats/stores/:storeId?lat=&lng= */
const getStore = async (req, res, next) => {
  try {
    const data = await knotEats.storeDetail(req.params.storeId, { lat: req.query.lat, lng: req.query.lng });
    if (!data) return next(unavailable());
    res.set("Cache-Control", "private, max-age=30");
    ok(res, data);
  } catch (error) {
    next(error);
  }
};

/** GET /api/eats/stores/:storeId/reviews?page= */
const getStoreReviews = async (req, res, next) => {
  try {
    const data = await knotEats.storeReviews(req.params.storeId, { page: req.query.page });
    if (!data) return next(unavailable());
    res.set("Cache-Control", "private, max-age=30");
    ok(res, data);
  } catch (error) {
    next(error);
  }
};

/**
 * The Knot Eats order behind a `v_` link, or null. A website order, an
 * order/checkout token of another kind, or a deleted order all read as "not
 * found" -- the link is the only credential a diner has.
 */
const loadEatsOrder = async (token) => {
  const parsed = readToken(token);
  if (!parsed?.isEatsOrder) return null;
  const order = await Order.findOne({ _id: parsed.id, isDeleted: { $ne: true } });
  return order && order.salesChannel === "KNOT_EATS" ? order : null;
};

const stageOf = (status) => {
  if (isCancelled(status) || isRefunded(status)) return "cancelled";
  if (isSettled(status)) return "completed";
  if (READY_STATUSES.includes(String(status || ""))) return "ready";
  // Past Ready, not back to "accepted" (where any unknown status used to fall).
  if (canonicalStatus(status) === OUT_FOR_DELIVERY) return "on_the_way";
  if (status === AWAITING_ACCEPTANCE) return "placed";
  return "accepted";
};

/**
 * Why this order can't be reviewed now, or "". One rule for the order page's
 * form and the POST, so the form never offers what the POST refuses.
 */
const reviewBlock = (order, now = Date.now()) => {
  const status = order.orderStatus;
  if (isCancelled(status) || isRefunded(status) || order.refundStatus === "REFUNDED") return "CANCELLED";
  if (!isSettled(status)) return "NOT_COMPLETED";
  const doneAt = new Date(order.completedAt || order.updatedAt || 0).getTime();
  if (now - doneAt > REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000) return "EXPIRED";
  return "";
};

const REVIEW_REFUSALS = {
  NOT_COMPLETED: [409, "You can review this order once it is completed."],
  CANCELLED: [409, "This order was cancelled, so it can't be reviewed."],
  EXPIRED: [410, `Reviews close ${REVIEW_WINDOW_DAYS} days after the order.`],
};

const publicReview = (r) => ({ rating: r.rating, text: r.text || "", authorName: r.authorName || "", createdAt: r.createdAt });

/** GET /api/eats/orders/:token */
const getOrder = async (req, res, next) => {
  try {
    const order = await loadEatsOrder(req.params.token);
    if (!order) return next(createHttpError(404, "Order not found."));

    const [settings, restaurant, existing] = await Promise.all([
      WebsiteSettings.findOne({ storeId: order.storeId }).select("-draft -paymentGateways -analytics"),
      order.restaurantId ? Restaurant.findById(order.restaurantId).lean() : null,
      KnotEatsReview.findOne({ orderId: order._id }).select("rating text authorName createdAt").lean(),
    ]);
    if (settings) applyPublishedSnapshot(settings);
    const contact = mergedContact(settings || {}, restaurant);

    // Whitelist of the website's own order view: no customer, no order id.
    const view = storefront().publicOrderView(order);
    const reason = existing ? "ALREADY_REVIEWED" : reviewBlock(order);
    res.set("Cache-Control", "no-store");
    ok(res, {
      order: {
        orderNumber: view.orderNumber,
        status: view.status,
        stage: stageOf(order.orderStatus),
        orderType: view.orderType,
        placedAt: view.placedAt,
        scheduledFor: view.scheduledFor,
        items: view.items,
        bills: view.bills,
        totalPaid: view.totalPaid,
        refundStatus: order.refundStatus || null,
        deliveryAddress: {
          line1: order.deliveryAddress?.line1 || "",
          line2: order.deliveryAddress?.line2 || "",
        },
      },
      store: {
        storeId: order.storeId,
        name: settings?.displayName || restaurant?.name || "",
        logo: settings?.branding?.logo?.url || "",
        phone: contact.phone,
        mapUrl: contact.mapUrl,
      },
      review: {
        canReview: reason === "",
        reason,
        existing: existing ? publicReview(existing) : null,
        // The masked name a review would show ("Asmit G."), for the form's
        // notice: the order view carries no customer details to build it from.
        authorName: maskAuthor(order.customerDetails?.name),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Control and zero-width characters: invisible padding, direction tricks.
const INVISIBLE = /[\u0000-\u001f​-‏﻿⁠]/g; // eslint-disable-line no-control-regex
const URL_LIKE = /https?:\/\/|www\./i;

/** "Asmit Ghosh" -> "Asmit G."; a phone number typed as a name never shows. */
const maskAuthor = (name) => {
  const clean = String(name || "").replace(INVISIBLE, "").trim();
  if (!clean || (clean.match(/\d/g) || []).length >= 5) return "Knot Eats customer";
  const words = clean.split(/\s+/);
  const out = words.length === 1 ? words[0] : `${words[0]} ${words[words.length - 1][0].toUpperCase()}.`;
  return out.slice(0, 40);
};

/** POST /api/eats/orders/:token/review  { rating, text } */
const postReview = async (req, res, next) => {
  try {
    const order = await loadEatsOrder(req.params.token);
    if (!order) return next(createHttpError(404, "Order not found."));

    const block = reviewBlock(order);
    if (block) {
      const [status, message] = REVIEW_REFUSALS[block];
      return next(httpError(status, message, block));
    }

    const raw = req.body?.rating;
    const rating = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return next(createHttpError(400, "Choose a rating from 1 to 5 stars."));
    }
    const text = String(req.body?.text ?? "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(INVISIBLE, "")
      .trim();
    if (text.length > 500) return next(createHttpError(400, "Keep your review under 500 characters."));
    if (URL_LIKE.test(text)) return next(createHttpError(400, "Links aren't allowed in reviews."));

    let review;
    try {
      review = await KnotEatsReview.create({
        storeId: order.storeId,
        restaurantId: order.restaurantId,
        orderId: order._id,
        orderNumber: order.orderNumber || "",
        rating,
        text,
        authorName: maskAuthor(order.customerDetails?.name),
      });
    } catch (err) {
      if (err?.code === 11000) return next(httpError(409, "You've already reviewed this order.", "ALREADY_REVIEWED"));
      throw err;
    }

    knotEats.invalidateListing();
    ok(res, { review: publicReview(review) }, 201);
  } catch (error) {
    next(error);
  }
};

/* ------------------------------------------------------------------ */
/* POS: the owner's opt-in                                             */
/* ------------------------------------------------------------------ */

/**
 * The Knot Eats fee the owner is consenting to, or null when none would be
 * charged (switched off, billing-exempt, or a 0 override). Shown on the POS
 * because opting in is agreeing to it -- the one place the per-order fee is
 * shown to an owner.
 */
const feeFor = async ({ restaurantId, storeId }) => {
  const { getPlatformConfig, getOverride, resolveOrderCharge } = pricing();
  const cfg = await getPlatformConfig();
  const override = await getOverride(restaurantId, { storeId });
  const r = await resolveOrderCharge({ restaurantId, source: "KNOT_EATS", config: cfg, override });
  if (!cfg.knotEatsOrderCharge?.enabled || override?.billingExempt || !(r.amountPaise > 0) || !r.startsAt) return null;
  return { amount: toRupees(r.amountPaise), taxable: r.taxable, startsAt: r.startsAt };
};

const posView = async ({ settings, tenant }) => {
  const storeId = settings.storeId;
  const restaurantId = settings.restaurantId || tenant?.restaurantId || null;
  const [store, restaurant] = await Promise.all([
    Store.findOne({ storeId, isDeleted: { $ne: true } }).lean(),
    restaurantId ? Restaurant.findById(restaurantId).lean() : null,
  ]);
  const timezone = restaurant?.timezone || "Asia/Kolkata";
  const dishes = await knotEats.buildStoreDishes({ restaurantId, timezone });
  const [{ listed, blockers }, ratings, fee] = await Promise.all([
    knotEats.eligibility({ settings, store, restaurant, restaurantId, dishCount: dishes.length }),
    knotEats.ratingsFor([storeId]),
    feeFor({ restaurantId, storeId }),
  ]);
  const ke = settings.knotEats || {};
  const ordering = settings.ordering || {};
  const a = restaurant?.address || {};
  return {
    enabled: Boolean(ke.enabled),
    enabledAt: ke.enabledAt || null,
    listed,
    blockers,
    delisted: Boolean(ke.delisted),
    delistedReason: ke.delisted ? ke.delistedReason || "" : "",
    pin: knotEats.isIndiaPoint(a.lat, a.lng) ? { lat: a.lat, lng: a.lng } : null,
    radiusKm: Number(ordering.deliverySlabsConfig?.maxDistanceKm || 7),
    pickupEnabled: ordering.pickupEnabled !== false,
    deliveryEnabled: ordering.deliveryEnabled === true,
    fee,
    ...ratings.get(storeId),
    publicUrl: config.knotEatsPublicUrl ? `${config.knotEatsPublicUrl}/store/${storeId}` : "",
  };
};

/** GET /api/website/knot-eats */
const getKnotEats = async (req, res, next) => {
  try {
    const view = await posView(await websiteSettings().loadOwnSettings(req));
    // The switch is the owner's own consent; a CSD "Open POS" session may not use it (setKnotEats).
    ok(res, { ...view, supportSession: await openedBySupport(req) });
  } catch (error) {
    next(error);
  }
};

/**
 * Was this POS session opened by CSD ("Open POS") rather than the owner?
 * Marked sessions say so. Ones opened before the mark existed do not, but
 * such a session starts the moment a CsdPosSession for this store is
 * exchanged, so a session created within a minute after an exchange counts
 * as CSD's too.
 * ponytail: the time match only covers unmarked sessions; drop it once those
 * have expired (sessions live 365 days).
 */
const openedBySupport = async (req) => {
  if (req.user?.supportPosSessionId) return true;
  const at = req.user?.sessionCreatedAt ? new Date(req.user.sessionCreatedAt) : null;
  if (!at || Number.isNaN(at.getTime()) || !req.user?.storeId) return false;
  const usedAt = { $gte: new Date(at.getTime() - 60 * 1000), $lte: new Date(at.getTime() + 5 * 1000) };
  return Boolean(await CsdPosSession.exists({ storeId: String(req.user.storeId), usedAt }));
};

/**
 * PUT /api/website/knot-eats  { enabled }  -- owner only (route).
 * Saved even with blockers: the store goes live by itself once they clear.
 */
const setKnotEats = async (req, res, next) => {
  try {
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") return next(createHttpError(400, "enabled must be true or false."));
    // Opting in is the owner's consent to the fee. A CSD "Open POS" session
    // signs in as the owner, so it may neither give nor withdraw that; CSD
    // delists through its own admin-only, audited endpoint.
    if (await openedBySupport(req)) {
      return next(createHttpError(403, "Only the store owner can switch Knot Eats on or off, from their own sign-in."));
    }
    const { settings } = await websiteSettings().loadOwnSettings(req);
    const was = Boolean(settings.knotEats?.enabled);

    if (enabled !== was) {
      // Dotted $set only: a whole-document save could resurrect a stale
      // `delisted` from this request's copy over a CSD decision.
      const set = enabled
        ? { "knotEats.enabled": true, "knotEats.enabledAt": new Date(), "knotEats.enabledBy": req.user?._id || null }
        : { "knotEats.enabled": false };
      await WebsiteSettings.updateOne({ storeId: settings.storeId }, { $set: set });
      await logActivity({
        req,
        action: enabled ? "Knot Eats opt-in" : "Knot Eats opt-out",
        resource: "Knot Eats",
        previousValue: was ? "listed" : "not listed",
        newValue: enabled ? "listed" : "not listed",
        description: enabled
          ? "Opted in to Knot Eats (agreed to the Knot Eats platform fee)"
          : "Opted out of Knot Eats",
      });
      knotEats.invalidateListing();
    }

    ok(res, await posView(await websiteSettings().loadOwnSettings(req)));
  } catch (error) {
    next(error);
  }
};

/* ------------------------------------------------------------------ */
/* CSD                                                                 */
/* ------------------------------------------------------------------ */

const pageOf = (v) => Math.max(1, Math.min(10_000, Math.floor(Number(v)) || 1));

/** CSD rows for a page of settings. ponytail: per-row eligibility, 25 rows max. */
const csdRows = async (rows) => {
  if (!rows.length) return [];
  const storeIds = rows.map((s) => s.storeId);
  const snapshot = await knotEats.getSnapshot();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [stores, ratings, counts] = await Promise.all([
    Store.find({ storeId: { $in: storeIds } }).lean(),
    knotEats.ratingsFor(storeIds),
    Order.aggregate([
      { $match: { storeId: { $in: storeIds }, salesChannel: "KNOT_EATS", createdAt: { $gte: since } } },
      { $group: { _id: "$storeId", n: { $sum: 1 } } },
    ]),
  ]);
  const storeBy = new Map(stores.map((s) => [s.storeId, s]));
  const rid = (s) => s.restaurantId || storeBy.get(s.storeId)?.restaurantId || null;
  const restaurants = new Map(
    (await Restaurant.find({ _id: { $in: rows.map(rid).filter(Boolean) } }).lean()).map((r) => [String(r._id), r]),
  );
  const orders = new Map(counts.map((c) => [c._id, c.n]));

  return Promise.all(
    rows.map(async (s) => {
      const restaurantId = rid(s);
      const restaurant = restaurantId ? restaurants.get(String(restaurantId)) : null;
      const store = storeBy.get(s.storeId);
      const dishes = await knotEats.buildStoreDishes({ restaurantId, timezone: restaurant?.timezone || "Asia/Kolkata" });
      const { blockers } = await knotEats.eligibility({
        settings: s,
        store: store?.isDeleted ? null : store,
        restaurant,
        restaurantId,
        dishCount: dishes.length,
      });
      const ke = s.knotEats || {};
      return {
        storeId: s.storeId,
        name: s.displayName || restaurant?.name || "",
        city: restaurant?.address?.city || "",
        enabled: Boolean(ke.enabled),
        enabledAt: ke.enabledAt || null,
        listed: snapshot.stores.has(s.storeId),
        blockers,
        delisted: Boolean(ke.delisted),
        delistedReason: ke.delistedReason || "",
        delistedAt: ke.delistedAt || null,
        delistedBy: ke.delistedBy || "",
        ...ratings.get(s.storeId),
        orders30d: orders.get(s.storeId) || 0,
      };
    }),
  );
};

const CSD_SETTINGS_FIELDS = "storeId restaurantId displayName enabled ordering knotEats";

/** GET /api/csd/knot-eats/stores?state=listed|blocked|delisted|all&q=&page= */
const csdListStores = async (req, res, next) => {
  try {
    const state = ["listed", "blocked", "delisted"].includes(req.query.state) ? req.query.state : "all";
    const page = pageOf(req.query.page);
    const listedIds = [...(await knotEats.getSnapshot()).stores.keys()];

    const and = [{ isDeleted: { $ne: true } }];
    if (state === "listed") and.push({ storeId: { $in: listedIds } });
    else if (state === "blocked") {
      and.push({ "knotEats.enabled": true, "knotEats.delisted": { $ne: true }, storeId: { $nin: listedIds } });
    } else if (state === "delisted") and.push({ "knotEats.delisted": true });
    else and.push({ $or: [{ "knotEats.enabled": true }, { "knotEats.delisted": true }] });

    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    if (q) and.push({ $or: [{ storeId: q }, { displayName: new RegExp(escapeRegex(q), "i") }] });

    const found = await WebsiteSettings.find({ $and: and })
      .sort({ "knotEats.enabledAt": -1, storeId: 1 })
      .skip((page - 1) * CSD_PAGE)
      .limit(CSD_PAGE + 1)
      .select(CSD_SETTINGS_FIELDS);

    ok(res, {
      rows: await csdRows(found.slice(0, CSD_PAGE)),
      meta: {
        page,
        hasMore: found.length > CSD_PAGE,
        canEdit: req.csdStaff?.role === "admin", // same predicate as requireCsdAdmin
        mapsUsage: mapsUsage(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/knot-eats/stores/:storeId  { delisted, reason } -- admin (route). */
const csdSetListing = async (req, res, next) => {
  try {
    const storeId = String(req.params.storeId || "");
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(404, "Store not found."));
    if (req.body?.enabled !== undefined) {
      return next(createHttpError(400, "Only the restaurant's owner can list or unlist it on Knot Eats."));
    }
    const delisted = req.body?.delisted;
    if (typeof delisted !== "boolean") return next(createHttpError(400, "delisted must be true or false."));
    const reason = String(req.body?.reason ?? "").trim();
    if (delisted && (reason.length < 5 || reason.length > 300)) {
      return next(
        createHttpError(400, "Give a reason (5-300 characters).", { fieldErrors: { reason: "5-300 characters." } }),
      );
    }

    const settings = await WebsiteSettings.findOne({ storeId, isDeleted: { $ne: true } }).select(CSD_SETTINGS_FIELDS);
    if (!settings) return next(createHttpError(404, "Store not found."));

    const staffId = req.csdStaff?.staffId || "";
    const set = delisted
      ? {
          "knotEats.delisted": true,
          "knotEats.delistedReason": reason,
          "knotEats.delistedAt": new Date(),
          "knotEats.delistedBy": staffId,
        }
      : { "knotEats.delisted": false, "knotEats.delistedReason": "", "knotEats.delistedAt": null, "knotEats.delistedBy": "" };
    await WebsiteSettings.updateOne({ storeId }, { $set: set });
    knotEats.invalidateListing();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: delisted ? "KNOT_EATS_DELISTED" : "KNOT_EATS_RELISTED",
      resource: "Knot Eats listing",
      entityType: "Store",
      entityId: storeId,
      storeId,
      description: delisted ? `Delisted from Knot Eats: ${reason}` : `Relisted on Knot Eats${reason ? `: ${reason}` : ""}`,
      severity: "WARNING",
    });

    const fresh = await WebsiteSettings.findOne({ storeId }).select(CSD_SETTINGS_FIELDS);
    ok(res, (await csdRows([fresh]))[0]);
  } catch (error) {
    next(error);
  }
};

const csdReviewRow = (r, names) => ({
  id: String(r._id),
  storeId: r.storeId,
  storeName: names.get(r.storeId) || "",
  orderNumber: r.orderNumber || "",
  rating: r.rating,
  text: r.text || "",
  authorName: r.authorName || "",
  createdAt: r.createdAt,
  hidden: Boolean(r.hidden),
  hiddenReason: r.hiddenReason || "",
  hiddenAt: r.hiddenAt || null,
  hiddenBy: r.hiddenBy || "",
});

/** storeId -> display name for review rows. */
const storeNames = async (reviews) => {
  const storeIds = [...new Set(reviews.map((r) => r.storeId))];
  const [settings, restaurants] = await Promise.all([
    WebsiteSettings.find({ storeId: { $in: storeIds } }).select("storeId displayName").lean(),
    Restaurant.find({ _id: { $in: [...new Set(reviews.map((r) => r.restaurantId).filter(Boolean).map(String))] } })
      .select("name")
      .lean(),
  ]);
  const byRestaurant = new Map(restaurants.map((r) => [String(r._id), r.name]));
  const names = new Map(settings.map((s) => [s.storeId, s.displayName]));
  for (const r of reviews) if (!names.get(r.storeId)) names.set(r.storeId, byRestaurant.get(String(r.restaurantId)) || "");
  return names;
};

/** GET /api/csd/knot-eats/reviews?state=visible|hidden|all&storeId=&maxRating=&page= */
const csdListReviews = async (req, res, next) => {
  try {
    const page = pageOf(req.query.page);
    const filter = {};
    if (req.query.state === "visible") filter.hidden = false;
    else if (req.query.state === "hidden") filter.hidden = true;
    if (/^\d{6}$/.test(String(req.query.storeId || ""))) filter.storeId = String(req.query.storeId);
    const maxRating = Number(req.query.maxRating);
    if (Number.isInteger(maxRating) && maxRating >= 1 && maxRating <= 5) filter.rating = { $lte: maxRating };

    const found = await KnotEatsReview.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * CSD_PAGE)
      .limit(CSD_PAGE + 1)
      .lean();
    const rows = found.slice(0, CSD_PAGE);
    const names = await storeNames(rows);
    ok(res, { rows: rows.map((r) => csdReviewRow(r, names)), meta: { page, hasMore: found.length > CSD_PAGE, canEdit: true } });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/csd/knot-eats/reviews/:id  { hidden, reason } -- any CSD staff. */
const csdSetReviewHidden = async (req, res, next) => {
  try {
    const id = String(req.params.id || "");
    if (!mongoose.isValidObjectId(id)) return next(createHttpError(404, "Review not found."));
    const hidden = req.body?.hidden;
    if (typeof hidden !== "boolean") return next(createHttpError(400, "hidden must be true or false."));
    const reason = String(req.body?.reason ?? "").trim();
    if (hidden && (!reason || reason.length > 300)) {
      return next(
        createHttpError(400, "Give a reason for hiding (up to 300 characters).", { fieldErrors: { reason: "Required." } }),
      );
    }

    const set = hidden
      ? { hidden: true, hiddenReason: reason, hiddenAt: new Date(), hiddenBy: req.csdStaff?.staffId || "" }
      : { hidden: false, hiddenReason: "", hiddenAt: null, hiddenBy: "" };
    const review = await KnotEatsReview.findOneAndUpdate({ _id: id }, { $set: set }, { new: true }).lean();
    if (!review) return next(createHttpError(404, "Review not found."));
    knotEats.invalidateListing();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: hidden ? "KNOT_EATS_REVIEW_HIDDEN" : "KNOT_EATS_REVIEW_UNHIDDEN",
      resource: "Knot Eats review",
      entityType: "KnotEatsReview",
      entityId: id,
      storeId: review.storeId,
      description: hidden
        ? `Hid a ${review.rating}★ review on order ${review.orderNumber || "?"}: ${reason}`
        : `Unhid a ${review.rating}★ review on order ${review.orderNumber || "?"}${reason ? `: ${reason}` : ""}`,
    });

    ok(res, csdReviewRow(review, await storeNames([review])));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConfig,
  listStores,
  getStore,
  getStoreReviews,
  getOrder,
  postReview,
  getKnotEats,
  setKnotEats,
  csdListStores,
  csdSetListing,
  csdListReviews,
  csdSetReviewHidden,
  maskAuthor,
  stageOf,
  REVIEW_WINDOW_DAYS,
};
