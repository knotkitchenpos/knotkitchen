const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const CsdAgreementLink = require("../models/csdAgreementLinkModel");
const portal = require("../services/onboardPortalService");
const { mapAgreementToStore } = require("../services/agreementMapper");
const { generateUniqueStoreId } = require("../services/storeIdGenerator");
const { provisionWebsiteForStore } = require("../services/websiteProvisioningService");
const { csdAudit } = require("../services/csdAuditService");

const str = (v) => String(v ?? "").trim();

/** Statuses the portal uses to mean "the agent has finished signing". */
const COMPLETED = new Set(["completed", "signed", "complete", "store created"]);
const isCompleted = (a) => COMPLETED.has(str(a?.status).toLowerCase());

/**
 * GET /api/csd/agreements — admin only.
 *
 * Signed agreements from the onboarding portal, each annotated with whether a
 * store already exists for it. That flag comes from OUR database, not the
 * portal's status field, so an agreement is never offered twice even if the
 * portal never learned about the first store.
 */
const listAgreements = async (req, res, next) => {
  try {
    if (!portal.isConfigured()) {
      return res.status(200).json({
        success: true,
        data: {
          configured: false,
          agreements: [],
          message:
            "The onboarding portal connection is not configured on this server. Set ONBOARD_SERVICE_TOKEN to enable agreement-driven store creation.",
        },
      });
    }

    const all = await portal.listAgreements();
    const links = await CsdAgreementLink.find({}, { agreementId: 1, storeId: 1, createdAt: 1 }).lean();
    const linkById = new Map(links.map((l) => [l.agreementId, l]));

    const agreements = all
      .filter(isCompleted)
      .map((a) => {
        const link = linkById.get(a.id);
        return {
          id: a.id,
          restaurantName: a.r_name || a.data?.r_display || "",
          ownerName: a.o_name || a.data?.o_name || "",
          salesAgent: a.sales_agent || a.data?.sales_agent || "",
          status: a.status,
          createdAt: a.created_at || null,
          storeCreated: !!link,
          storeId: link?.storeId || null,
          storeCreatedAt: link?.createdAt || null,
        };
      })
      // Unprocessed first — that is the admin's actual queue.
      .sort((x, y) => Number(x.storeCreated) - Number(y.storeCreated));

    res.status(200).json({
      success: true,
      data: {
        configured: true,
        agreements,
        pending: agreements.filter((a) => !a.storeCreated).length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/csd/agreements/:id — admin only.
 *
 * The agreement plus a preview of exactly what the store would be created
 * with, so the admin confirms real values rather than trusting a mapping they
 * cannot see.
 */
const getAgreement = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    const agreement = await portal.getAgreement(id);
    const link = await CsdAgreementLink.findOne({ agreementId: id }).lean();
    const { values, missing, warnings } = mapAgreementToStore(agreement);

    res.status(200).json({
      success: true,
      data: {
        id: agreement.id,
        status: agreement.status,
        salesAgent: agreement.sales_agent || agreement.data?.sales_agent || "",
        createdAt: agreement.created_at || null,
        completed: isCompleted(agreement),
        storeCreated: !!link,
        storeId: link?.storeId || null,
        mapped: values,
        missing,
        warnings,
        // Coordinates are the one thing the agreement never carries — the
        // admin supplies them (§ "Only manual input required").
        needsCoordinates: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

const parseCoordinate = (v, { min, max, label }) => {
  if (v === undefined || v === null || str(v) === "") return { error: `${label} is required.` };
  const n = Number(v);
  if (Number.isNaN(n)) return { error: `${label} must be a number.` };
  if (n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` };
  return { value: n };
};

/**
 * POST /api/csd/agreements/:id/create-store — admin only.
 *
 * Creates the store from the agreement, with the admin-supplied coordinates.
 *
 * Duplicate protection is the unique index on CsdAgreementLink.agreementId,
 * not a read-then-write check: two admins clicking at the same moment would
 * both pass a pre-check. The link is written FIRST, so whoever loses the race
 * fails before creating anything.
 */
const createStoreFromAgreement = async (req, res, next) => {
  const id = str(req.params.id);
  let link = null;
  let restaurant = null;

  try {
    const existing = await CsdAgreementLink.findOne({ agreementId: id }).lean();
    if (existing) {
      return next(
        createHttpError(409, `A store was already created from this agreement (${existing.storeId}).`)
      );
    }

    const agreement = await portal.getAgreement(id);
    if (!isCompleted(agreement)) {
      return next(createHttpError(400, "This agreement is not marked as completed."));
    }

    const { values, missing, warnings } = mapAgreementToStore(agreement);
    if (missing.length) {
      return next(
        createHttpError(400, `The agreement is missing required information: ${missing.join(", ")}.`, {
          fieldErrors: { agreement: missing.join(", ") },
        })
      );
    }

    const lat = parseCoordinate(req.body?.latitude, { min: -90, max: 90, label: "Latitude" });
    const lng = parseCoordinate(req.body?.longitude, { min: -180, max: 180, label: "Longitude" });
    const fieldErrors = {};
    if (lat.error) fieldErrors.latitude = lat.error;
    if (lng.error) fieldErrors.longitude = lng.error;
    if (Object.keys(fieldErrors).length) {
      return next(createHttpError(400, "Enter the restaurant's coordinates.", { fieldErrors }));
    }

    const storeId = await generateUniqueStoreId();

    // Claim the agreement BEFORE creating anything. If a concurrent request
    // already claimed it, the unique index rejects this one and no duplicate
    // restaurant is created.
    try {
      link = await CsdAgreementLink.create({
        agreementId: id,
        storeId,
        restaurantName: values.restaurantName,
        salesAgent: values.salesAgentName,
        createdById: req.csdStaff._id,
        createdByStaffId: req.csdStaff.staffId,
        createdByName: req.csdStaff.fullName,
        sourceSnapshot: agreement,
      });
    } catch (err) {
      if (err?.code === 11000) {
        const winner = await CsdAgreementLink.findOne({ agreementId: id }).lean();
        return next(
          createHttpError(409, `A store was already created from this agreement (${winner?.storeId}).`)
        );
      }
      throw err;
    }

    restaurant = await Restaurant.create({
      name: values.restaurantName,
      legalName: values.legalName,
      storeId,
      address: {
        line1: values.addressLine1,
        line2: values.addressLine2,
        city: values.city,
        state: values.state,
        postalCode: values.postalCode,
        country: "India",
        lat: lat.value,
        lng: lng.value,
      },
      ownerName: values.ownerName,
      ownerPhone: values.ownerPhone,
      ownerEmail: values.ownerEmail,
      restaurantPhone: values.restaurantPhone,
      restaurantType: values.restaurantType,
      mapsLink: values.mapsLink,
      gstRegistered: values.gstRegistered,
      taxId: values.gstRegistered ? values.gstin : "",
      fssaiNumber: values.fssaiNumber,
      fssaiValidUntil: values.fssaiValidUntil ? new Date(values.fssaiValidUntil) : null,
      salesAgentName: values.salesAgentName,
      currency: "INR",
      timezone: "Asia/Kolkata",
      isActive: true,
    });

    let store;
    try {
      store = await Store.create({
        storeId,
        storeName: values.restaurantName,
        ownerName: values.ownerName,
        ownerPhone: values.ownerPhone,
        status: "active",
        restaurantId: restaurant._id,
      });
    } catch (storeErr) {
      // Unwind so a retry is clean rather than leaving an orphan restaurant
      // and a link pointing at a store that does not exist.
      await Restaurant.deleteOne({ _id: restaurant._id }).catch(() => {});
      await CsdAgreementLink.deleteOne({ _id: link._id }).catch(() => {});
      link = null;
      throw storeErr;
    }

    link.restaurantId = restaurant._id;
    await link.save();

    // Idempotent and re-runnable: a failure leaves a working store.
    let storefront = null;
    let storefrontError = null;
    try {
      storefront = await provisionWebsiteForStore({
        storeId,
        storeName: values.restaurantName,
        restaurantId: restaurant._id,
        currency: "INR",
        contact: { phone: values.restaurantPhone || values.ownerPhone, email: values.ownerEmail },
      });
    } catch (err) {
      storefrontError = err.message;
    }

    // Best-effort by design — the store exists either way, and the link
    // records that the portal still needs telling.
    try {
      await portal.markStoreCreated(id, {
        storeId,
        storeCreatedAt: new Date().toISOString(),
        by: `${req.csdStaff.staffId} ${req.csdStaff.fullName}`,
      });
      link.portalNotified = true;
    } catch (err) {
      link.portalNotified = false;
      link.portalNotifyError = err.message;
    }
    await link.save();

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_STORE_CREATED_FROM_AGREEMENT",
      resource: "Store",
      entityType: "Store",
      entityId: store._id,
      storeId,
      description: `Store ${storeId} created from agreement ${id} (${values.restaurantName})`,
      newValue: { agreementId: id, storeId, salesAgent: values.salesAgentName },
    });

    res.status(201).json({
      success: true,
      data: {
        storeId,
        agreementId: id,
        restaurantName: values.restaurantName,
        restaurantId: String(restaurant._id),
        status: store.status,
        coordinates: { latitude: lat.value, longitude: lng.value },
        storefrontSlug: storefront?.slug || null,
        storefrontError,
        portalNotified: link.portalNotified,
        portalNotifyError: link.portalNotifyError || null,
        warnings,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createHttpError(409, "That store could not be created — please try again."));
    }
    next(error);
  }
};

/** POST /api/csd/agreements/:id/retry-notify — re-tell the portal. */
const retryPortalNotify = async (req, res, next) => {
  try {
    const id = str(req.params.id);
    const link = await CsdAgreementLink.findOne({ agreementId: id });
    if (!link) return next(createHttpError(404, "No store has been created from this agreement."));
    if (link.portalNotified) {
      return res.status(200).json({ success: true, data: { portalNotified: true } });
    }

    try {
      await portal.markStoreCreated(id, {
        storeId: link.storeId,
        storeCreatedAt: link.createdAt.toISOString(),
        by: `${req.csdStaff.staffId} ${req.csdStaff.fullName}`,
      });
      link.portalNotified = true;
      link.portalNotifyError = "";
    } catch (err) {
      link.portalNotifyError = err.message;
      await link.save();
      return next(createHttpError(502, `The onboarding portal could not be updated: ${err.message}`));
    }

    await link.save();
    res.status(200).json({ success: true, data: { portalNotified: true } });
  } catch (error) {
    next(error);
  }
};

module.exports = { listAgreements, getAgreement, createStoreFromAgreement, retryPortalNotify, isCompleted };
