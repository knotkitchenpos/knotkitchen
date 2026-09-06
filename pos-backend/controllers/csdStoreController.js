const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const CsdAgreementLink = require("../models/csdAgreementLinkModel");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");
const { csdAudit } = require("../services/csdAuditService");
const onboardPortalService = require("../services/onboardPortalService");
const { formatAddress } = require("../services/address");

/** Escape user input before it reaches a RegExp — otherwise "(" or "*" throws. */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Present a Store + its Restaurant as one flat row for the results table. */
const toResultRow = (store, restaurant, website = "") => {
  const address = formatAddress(restaurant?.address);

  return {
    storeId: store.storeId,
    restaurantName: restaurant?.name || store.storeName || "",
    ownerName: store.ownerName || restaurant?.ownerName || "",
    ownerPhone: store.ownerPhone || restaurant?.ownerPhone || "",
    address,
    city: a.city || "",
    state: a.state || "",
    website,
    status: store.status,
    closedUntil: store.closedUntil || null,
    restaurantId: restaurant ? String(restaurant._id) : null,
    createdAt: store.createdAt,
  };
};

/**
 * GET /api/csd/stores/search?q=...&limit=&status=
 *
 * The header's global search. One box, matching any of: Store ID, restaurant
 * name, owner phone, or address.
 *
 * Store and Restaurant are separate collections with the addresses living on
 * Restaurant, so an address query can't be expressed as a single Store find().
 * Rather than $lookup (which can't use the text indexes on either side well
 * here), this queries both collections and unions on storeId. Both halves are
 * capped so a one-character query can't pull the whole database into memory.
 */
const searchStores = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const rx = q.length >= 2 ? new RegExp(escapeRegex(q), "i") : null;
    const digits = q.replace(/\D/g, "");
    const SCAN_CAP = 200;

    // Empty query = "browse mode": return the most recent stores so an admin
    // opening Store Management sees the registry instead of a blank slate.
    // Filters (status, storeId prefix if the box holds only digits) still
    // apply even when q is empty.
    const storeFilter = { isDeleted: { $ne: true } };
    if (rx) storeFilter.$or = [{ storeName: rx }, { ownerName: rx }];
    if (/^\d{1,6}$/.test(digits)) {
      const idClause = { storeId: new RegExp(`^${digits}`) };
      storeFilter.$or ? storeFilter.$or.push(idClause) : (storeFilter.$or = [idClause]);
    }
    if (digits.length >= 4) {
      const phClause = { ownerPhone: new RegExp(escapeRegex(digits)) };
      storeFilter.$or ? storeFilter.$or.push(phClause) : (storeFilter.$or = [phClause]);
    }
    if (status) storeFilter.status = status;

    const restaurantFilter = {
      isDeleted: { $ne: true },
      $or: [
        { name: rx },
        { "address.line1": rx },
        { "address.line2": rx },
        { "address.city": rx },
        { "address.state": rx },
        { "address.postalCode": rx },
      ],
    };
    if (digits.length >= 4) restaurantFilter.$or.push({ ownerPhone: new RegExp(escapeRegex(digits)) });

    const [storeHits, restaurantHits] = await Promise.all([
      Store.find(storeFilter).sort({ createdAt: -1 }).limit(SCAN_CAP).lean(),
      // Restaurant-side text/address query only makes sense once the operator
      // has actually typed something; browsing skips it entirely.
      rx
        ? Restaurant.find(restaurantFilter, { name: 1, address: 1, storeId: 1, ownerName: 1, ownerPhone: 1 })
            .limit(SCAN_CAP)
            .lean()
        : Promise.resolve([]),
    ]);

    // Union by storeId. Restaurant rows without a storeId can't be actioned
    // from this panel, so they're dropped rather than shown as dead entries.
    const storeIds = new Set(storeHits.map((s) => s.storeId));
    for (const r of restaurantHits) if (r.storeId) storeIds.add(r.storeId);

    const allIds = [...storeIds];
    const truncated = allIds.length > limit;
    const pageIds = allIds.slice(0, limit);

    // Website settings are fetched only for the page being returned, so the
    // storefront URL on each card costs one extra indexed query, not one per
    // candidate match.
    const [stores, restaurants, websites] = await Promise.all([
      Store.find({ storeId: { $in: pageIds }, isDeleted: { $ne: true } }).lean(),
      Restaurant.find(
        { storeId: { $in: pageIds }, isDeleted: { $ne: true } },
        { name: 1, address: 1, storeId: 1, ownerName: 1, ownerPhone: 1 }
      ).lean(),
      WebsiteSettings.find(
        { storeId: { $in: pageIds }, isDeleted: { $ne: true } },
        { storeId: 1, slug: 1, subdomain: 1, customDomain: 1 }
      ).lean(),
    ]);

    const byStoreId = new Map(restaurants.map((r) => [r.storeId, r]));
    const siteByStoreId = new Map(websites.map((w) => [w.storeId, buildStorefrontUrl(w)]));
    const results = stores
      .filter((s) => !status || s.status === status)
      .map((s) => toResultRow(s, byStoreId.get(s.storeId), siteByStoreId.get(s.storeId) || ""))
      .sort((a, b) => a.restaurantName.localeCompare(b.restaurantName));

    res.status(200).json({ success: true, data: { results, query: q, truncated } });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/stores/:storeId
 *
 * Full store profile. Available to staff as well as admins — viewing store
 * details is core CSD work.
 */
const getStore = async (req, res, next) => {
  try {
    const storeId = String(req.params.storeId || "").trim();
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Invalid Store ID."));

    const store = await Store.findOne({ storeId, isDeleted: { $ne: true } }).lean();
    if (!store) return next(createHttpError(404, "Store not found."));

    const restaurant = await Restaurant.findOne(
      { storeId, isDeleted: { $ne: true } },
      { securityPin: 0 } // never expose the store's protection PIN hash
    ).lean();

    res.status(200).json({
      success: true,
      data: {
        ...toResultRow(store, restaurant),
        restaurant: restaurant
          ? {
              id: String(restaurant._id),
              name: restaurant.name,
              legalName: restaurant.legalName,
              taxId: restaurant.taxId,
              fssaiNumber: restaurant.fssaiNumber,
              mapsLink: restaurant.mapsLink,
              ownerEmail: restaurant.ownerEmail,
              currency: restaurant.currency,
              timezone: restaurant.timezone,
              isActive: restaurant.isActive,
              address: restaurant.address || {},
              subscription: restaurant.subscription || {},
              createdAt: restaurant.createdAt,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/csd/stores/:storeId/status — admin only.
 *
 * Changing a store's status decides whether its storefront serves customers
 * at all (storefrontResolver refuses suspended/closed stores), so this is
 * admin-gated and always audited with the previous value.
 */
// "deleted" is a terminal status. The store's row keeps its status field
// for audit but is also isDeleted-flagged so every isDeleted:{$ne:true}
// query across the app hides it. The associated Restaurant and the
// agreement link are removed too — see permanentlyDeleteStore below.
const ALLOWED_STATUS = ["active", "pending", "suspended", "closed_temporarily", "closed_until", "deleted"];

/**
 * Terminal delete path. Soft-deletes the Store and Restaurant, drops the
 * CsdAgreementLink so the agreement is no longer marked "already processed",
 * and asks the onboarding portal to delete its own copy of the agreement
 * (files + record) so the whole thing genuinely goes away.
 *
 * Best-effort on the portal call: the local delete has already committed by
 * the time we hit the network, so a portal failure surfaces as a warning
 * rather than rolling back. The link row is deleted regardless because it is
 * the local record of "this agreement produced a store" and the store no
 * longer exists.
 */
const permanentlyDeleteStore = async ({ req, store, storeId, reason }) => {
  const previous = { status: store.status, closedUntil: store.closedUntil || null };

  const link = await CsdAgreementLink.findOne({ storeId }).lean();
  const agreementId = link?.agreementId || "";

  // 1. Local: mark store deleted (keep the doc for audit + FK integrity).
  store.status = "deleted";
  store.closedUntil = null;
  store.closureReason = reason || "Permanently deleted";
  store.isDeleted = true;
  await store.save();

  // 2. Restaurant: hide it from every query without hard-deleting so
  //    orders / payments retain their FK targets for reconciliation.
  if (store.restaurantId) {
    await Restaurant.updateOne(
      { _id: store.restaurantId },
      { $set: { isDeleted: true } }
    );
  }

  // 3. Local agreement link: gone. Without this row, listing the portal's
  //    agreements will no longer show a "store already created" badge.
  if (link?._id) {
    await CsdAgreementLink.deleteOne({ _id: link._id });
  }

  // 4. Remote agreement + files: best-effort. Never block on this.
  let portalError = "";
  if (agreementId) {
    try {
      if (onboardPortalService.isConfigured()) {
        await onboardPortalService.deleteAgreement(agreementId);
      } else {
        portalError = "Onboarding portal not configured; agreement not removed.";
      }
    } catch (e) {
      portalError = e?.message || "Portal deletion failed.";
    }
  }

  await csdAudit({
    req,
    staff: req.csdStaff,
    action: "CSD_STORE_DELETED",
    resource: "Store",
    entityType: "Store",
    entityId: store._id,
    storeId,
    description: `Store ${storeId} permanently deleted (agreement ${agreementId || "(none)"})`,
    previousValue: previous,
    newValue: {
      status: "deleted",
      reason: store.closureReason,
      agreementId: agreementId || null,
      portalError: portalError || null,
    },
    severity: "CRITICAL",
  });

  return { agreementId, portalError };
};

const updateStoreStatus = async (req, res, next) => {
  try {
    const storeId = String(req.params.storeId || "").trim();
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Invalid Store ID."));

    const status = String(req.body?.status || "").trim();
    if (!ALLOWED_STATUS.includes(status)) {
      return next(createHttpError(400, `Status must be one of: ${ALLOWED_STATUS.join(", ")}`));
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 500);

    let closedUntil = null;
    if (status === "closed_until") {
      const d = new Date(req.body?.closedUntil);
      if (Number.isNaN(d.getTime())) {
        return next(createHttpError(400, "Provide the date this store reopens."));
      }
      if (d.getTime() <= Date.now()) {
        // A past date would leave the store instantly open again while the UI
        // still displayed "closed until" — refuse rather than mislead.
        return next(createHttpError(400, "The reopening date must be in the future."));
      }
      closedUntil = d;
    }

    const store = await Store.findOne({ storeId, isDeleted: { $ne: true } });
    if (!store) return next(createHttpError(404, "Store not found."));

    // Terminal path: destroys the store + its agreement.
    if (status === "deleted") {
      const { agreementId, portalError } = await permanentlyDeleteStore({
        req,
        store,
        storeId,
        reason,
      });
      return res.status(200).json({
        success: true,
        data: {
          storeId,
          status: "deleted",
          agreementId: agreementId || null,
          portalError: portalError || null,
        },
        message: portalError
          ? `Store deleted, but the agreement portal call failed: ${portalError}`
          : "Store and agreement permanently deleted.",
      });
    }

    const previous = { status: store.status, closedUntil: store.closedUntil || null };

    store.status = status;
    store.closedUntil = closedUntil;
    store.closureReason = status === "active" ? "" : reason;
    await store.save();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_STORE_STATUS_CHANGED",
      resource: "Store",
      entityType: "Store",
      entityId: store._id,
      storeId,
      description: `Store ${storeId} status ${previous.status} → ${status}`,
      previousValue: previous,
      newValue: { status, closedUntil, reason: store.closureReason },
      severity: status === "suspended" ? "WARNING" : "INFO",
    });

    res.status(200).json({
      success: true,
      data: { storeId, status: store.status, closedUntil: store.closedUntil, reason: store.closureReason },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { searchStores, getStore, updateStoreStatus, ALLOWED_STATUS };
