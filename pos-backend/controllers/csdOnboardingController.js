const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const { generateUniqueStoreId } = require("../services/storeIdGenerator");
const { provisionWebsiteForStore } = require("../services/websiteProvisioningService");
const { normalizePhone } = require("../services/otpService");
const { csdAudit } = require("../services/csdAuditService");

const RESTAURANT_TYPES = [
  "Fine Dining", "Casual Dining", "Quick Service", "Cafe", "Cloud Kitchen",
  "Bakery", "Bar / Pub", "Food Truck", "Sweet Shop", "Other",
];

const str = (v) => String(v ?? "").trim();

// Format-only checks. These catch typos at the point of entry; they are not a
// claim that the number is registered with GST/FSSAI.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
const FSSAI_RE = /^\d{14}$/;
const PIN_RE = /^\d{6}$/;

/**
 * Validate the onboarding payload, returning { values, errors }.
 * Collects EVERY problem rather than failing on the first, so the form can
 * highlight all bad fields in one round trip.
 */
const validate = (body) => {
  const errors = {};
  const v = {
    restaurantName: str(body.restaurantName),
    addressLine1: str(body.addressLine1),
    addressLine2: str(body.addressLine2),
    city: str(body.city),
    state: str(body.state),
    postalCode: str(body.postalCode),
    restaurantPhone: normalizePhone(body.restaurantPhone),
    mapsLink: str(body.mapsLink),
    restaurantType: str(body.restaurantType),
    ownerName: str(body.ownerName),
    ownerPhone: normalizePhone(body.ownerPhone),
    ownerEmail: str(body.ownerEmail).toLowerCase(),
    gstRegistered: body.gstRegistered === true || body.gstRegistered === "true",
    gstin: str(body.gstin).toUpperCase(),
    fssaiNumber: str(body.fssaiNumber),
    fssaiValidUntil: str(body.fssaiValidUntil),
  };

  if (v.restaurantName.length < 2) errors.restaurantName = "Enter the restaurant's display name.";
  if (!v.addressLine1) errors.addressLine1 = "Enter the street address.";
  if (!v.city) errors.city = "Enter the city.";
  if (!v.state) errors.state = "Enter the state.";
  if (!PIN_RE.test(v.postalCode)) errors.postalCode = "PIN code must be 6 digits.";
  if (v.restaurantPhone && !/^\d{10}$/.test(v.restaurantPhone))
    errors.restaurantPhone = "Restaurant phone must be 10 digits.";
  if (v.mapsLink && !/^https?:\/\//i.test(v.mapsLink))
    errors.mapsLink = "Maps link must start with http:// or https://";
  if (v.restaurantType && !RESTAURANT_TYPES.includes(v.restaurantType))
    errors.restaurantType = "Choose a restaurant type from the list.";

  if (v.ownerName.length < 2) errors.ownerName = "Enter the owner's name.";
  if (!/^\d{10}$/.test(v.ownerPhone)) errors.ownerPhone = "Owner phone must be 10 digits.";
  if (v.ownerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.ownerEmail))
    errors.ownerEmail = "Enter a valid email address.";

  // Only demand a GSTIN when the operator said the business is registered.
  if (v.gstRegistered) {
    if (!v.gstin) errors.gstin = "Enter the GSTIN, or mark the business as not GST registered.";
    else if (!GSTIN_RE.test(v.gstin)) errors.gstin = "That doesn't look like a valid GSTIN.";
  }

  if (v.fssaiNumber && !FSSAI_RE.test(v.fssaiNumber))
    errors.fssaiNumber = "FSSAI licence number must be 14 digits.";

  if (v.fssaiValidUntil) {
    const d = new Date(v.fssaiValidUntil);
    if (Number.isNaN(d.getTime())) errors.fssaiValidUntil = "Enter a valid date.";
    else v.fssaiValidUntilDate = d;
  }

  return { values: v, errors };
};

/** GET /api/csd/onboarding/options — keeps the form's dropdown server-driven. */
const getOptions = (req, res) =>
  res.status(200).json({ success: true, data: { restaurantTypes: RESTAURANT_TYPES } });

/**
 * POST /api/csd/onboarding/stores — admin only.
 *
 * Creates Restaurant → Store → storefront and returns the generated Store ID.
 *
 * There is no multi-document transaction here because the deployment target is
 * a single-node Mongo where transactions are unavailable. Instead the writes
 * are ordered so a mid-way failure is recoverable rather than corrupting:
 * the Restaurant is written first and rolled back explicitly if the Store
 * write fails, and website provisioning (which is idempotent and re-runnable)
 * happens last, where a failure leaves a usable store rather than blocking it.
 */
const createStore = async (req, res, next) => {
  let restaurant = null;
  try {
    const { values: v, errors } = validate(req.body || {});
    if (Object.keys(errors).length) {
      return next(createHttpError(400, "Please correct the highlighted fields.", { fieldErrors: errors }));
    }

    const storeId = await generateUniqueStoreId();

    restaurant = await Restaurant.create({
      name: v.restaurantName,
      storeId,
      address: {
        line1: v.addressLine1,
        line2: v.addressLine2,
        city: v.city,
        state: v.state,
        postalCode: v.postalCode,
        country: "India",
      },
      ownerName: v.ownerName,
      ownerPhone: v.ownerPhone,
      ownerEmail: v.ownerEmail,
      restaurantPhone: v.restaurantPhone,
      restaurantType: v.restaurantType,
      mapsLink: v.mapsLink,
      gstRegistered: v.gstRegistered,
      taxId: v.gstRegistered ? v.gstin : "",
      fssaiNumber: v.fssaiNumber,
      fssaiValidUntil: v.fssaiValidUntilDate || null,
      currency: "INR",
      timezone: "Asia/Kolkata",
      isActive: true,
    });

    let store;
    try {
      store = await Store.create({
        storeId,
        storeName: v.restaurantName,
        ownerName: v.ownerName,
        ownerPhone: v.ownerPhone,
        // Onboarded stores start active — a CSD admin creating one has already
        // done the verification this status would otherwise be waiting for.
        status: "active",
        restaurantId: restaurant._id,
      });
    } catch (storeErr) {
      // Roll back the orphan so the storeId is not burned and the operator can
      // simply retry.
      await Restaurant.deleteOne({ _id: restaurant._id }).catch(() => {});
      restaurant = null;
      throw storeErr;
    }

    // Idempotent and safely re-runnable, so a failure here must not fail the
    // whole onboarding — the store already exists and is usable.
    let storefront = null;
    let storefrontError = null;
    try {
      storefront = await provisionWebsiteForStore({
        storeId,
        storeName: v.restaurantName,
        restaurantId: restaurant._id,
        currency: "INR",
        contact: { phone: v.restaurantPhone || v.ownerPhone, email: v.ownerEmail },
      });
    } catch (err) {
      storefrontError = err.message;
      // eslint-disable-next-line no-console
      console.error(`[CSD] storefront provisioning failed for ${storeId}:`, err.message);
    }

    await csdAudit({
      req,
      staff: req.csdStaff,
      action: "CSD_STORE_ONBOARDED",
      resource: "Store",
      entityType: "Store",
      entityId: store._id,
      storeId,
      description: `Onboarded "${v.restaurantName}" as store ${storeId}`,
      newValue: { storeId, restaurantName: v.restaurantName, ownerPhone: v.ownerPhone },
    });

    res.status(201).json({
      success: true,
      data: {
        storeId,
        restaurantId: String(restaurant._id),
        restaurantName: v.restaurantName,
        status: store.status,
        storefrontSlug: storefront?.slug || null,
        // Surfaced so the operator knows the storefront needs a retry rather
        // than assuming everything completed.
        storefrontError,
      },
    });
  } catch (error) {
    if (error?.code === 11000) {
      return next(createHttpError(409, "That store could not be created — please try again."));
    }
    next(error);
  }
};

module.exports = { createStore, getOptions, RESTAURANT_TYPES, validate };
