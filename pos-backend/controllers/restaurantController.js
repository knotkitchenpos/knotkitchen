const createHttpError = require("http-errors");
const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const { logActivity } = require("../services/auditService");

const getMyRestaurant = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
      isDeleted: false,
    });
    if (!restaurant) {
      const error = createHttpError(404, "No restaurant found!");
      return next(error);
    }
    res.status(200).json({ success: true, data: restaurant });
  } catch (error) {
    next(error);
  }
};

const bcrypt = require("bcrypt");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");

/** posSettings with every field present, including ones added after the restaurant was saved. */
const receiptSettingsOf = (restaurant) => {
  const s = (restaurant && restaurant.posSettings) || {};
  return {
    autoEBill: Boolean(s.autoEBill),
    customMessage: s.customMessage ?? "Thank you for visiting us!",
    showWebsiteLink: Boolean(s.showWebsiteLink),
    websiteLink: s.websiteLink || "",
    showQrCode: Boolean(s.showQrCode),
    qrCodeImage: s.qrCodeImage || "",
    showLogo: s.showLogo !== false,
  };
};

/** An image URL (http(s) or /uploads/...). Anything else is dropped. */
const cleanImageUrl = (value) => {
  const v = String(value || "").trim().slice(0, 500);
  return /^(https?:\/\/|\/uploads\/)/i.test(v) ? v : "";
};

/** A website address, printed as text. https:// is assumed when left off. */
const cleanWebsiteLink = (value) => {
  const v = String(value || "").trim().slice(0, 200);
  if (!v) return "";
  if (/^https?:\/\/\S+$/i.test(v)) return v;
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?$/i.test(v) ? `https://${v}` : "";
};

const DEFAULT_PIN = "8796";

const verifyPinHelper = async (restaurant, pinInput) => {
  const inputPin = String(pinInput || "").trim();
  if (!inputPin) return false;
  if (restaurant.securityPin) {
    return await bcrypt.compare(inputPin, restaurant.securityPin);
  }
  return inputPin === DEFAULT_PIN;
};

// Module 7 §1 — Get Store Properties
const getStoreProperties = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "No restaurant found!"));

    const owner = restaurant.ownerId ? await User.findById(restaurant.ownerId) : null;
    const settings = await WebsiteSettings.findOne({ restaurantId: restaurant._id, isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        storeName: restaurant.name,
        ownerName: restaurant.ownerName || owner?.name || "",
        fullAddress: restaurant.address?.line1 || "",
        secondAddress: restaurant.address?.line2 || "",
        city: restaurant.address?.city || "",
        postalCode: restaurant.address?.postalCode || "",
        latitude: restaurant.address?.lat || null,
        longitude: restaurant.address?.lng || null,
        googleMapsLink: restaurant.mapsLink || "",
        ownerPhone: restaurant.ownerPhone || owner?.phone || "",
        contactPersonPhone: restaurant.contactPersonPhone || "",
        ownerEmail: restaurant.ownerEmail || owner?.email || "",
        fssaiNumber: restaurant.fssaiNumber || "",
        gstNumber: restaurant.taxId || "",
        // The website's logo is the one CSD and Manage Website edit; the two
        // are kept in step on every save, so this order only matters for
        // stores saved before they were.
        restaurantLogo: settings?.branding?.logo?.url || restaurant.branding?.logo || "",
        posSettings: receiptSettingsOf(restaurant),
        // The website link printed on receipts when none is typed in.
        websiteUrl: buildStorefrontUrl(settings),
        orderTypeToggles: restaurant.orderTypeToggles || { collection: true, delivery: true, table: true },
        hasCustomPin: Boolean(restaurant.securityPin),
      },
    });
  } catch (error) {
    next(error);
  }
};

// Module 7 §2 — Verify Protection PIN
const verifyPin = async (req, res, next) => {
  try {
    const { pin } = req.body || {};
    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    const ok = await verifyPinHelper(restaurant, pin);
    // Never name the default in a FAILURE response: that hands the value
    // gating every protected action to whoever is guessing at it.
    if (!ok) return next(createHttpError(401, "Invalid Security PIN."));

    const jwt = require("jsonwebtoken");
    const config = require("../config/config");
    const pinToken = jwt.sign(
      { userId: req.user._id, restaurantId: restaurant._id, elevated: true },
      config.accessTokenSecret,
      { expiresIn: "15m" }
    );

    res.status(200).json({
      success: true,
      message: "PIN verified successfully!",
      pinToken,
      expiresAt: Date.now() + 15 * 60 * 1000,
    });
  } catch (error) {
    next(error);
  }
};

// Module 7 §2 — Change Protection PIN (Owner only)
const changePin = async (req, res, next) => {
  try {
    const { currentPin, newPin } = req.body || {};
    if (req.user.role !== "Owner" && req.user.role !== "owner") {
      return next(createHttpError(403, "Only the store owner can change the protection PIN."));
    }

    if (!newPin || !/^\d{4,8}$/.test(String(newPin).trim())) {
      return next(createHttpError(400, "New PIN must be 4 to 8 digits."));
    }

    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    const ok = await verifyPinHelper(restaurant, currentPin);
    if (!ok) return next(createHttpError(401, "Current PIN is invalid."));

    const salt = await bcrypt.genSalt(10);
    restaurant.securityPin = await bcrypt.hash(String(newPin).trim(), salt);
    await restaurant.save();

    await logActivity({
      req,
      action: "Changed Protection PIN",
      resource: "Security PIN",
      previousValue: "Previous PIN Hash",
      newValue: "New PIN Hash updated",
      description: `Protection PIN changed by ${req.user.name || req.user.phone}`,
    });

    res.status(200).json({ success: true, message: "Protection PIN updated successfully!" });
  } catch (error) {
    next(error);
  }
};

// Module 7 §1 / §2 — Update Protected Store Properties (Requires PIN)
const updateStoreProperties = async (req, res, next) => {
  try {
    const { pin, ...props } = req.body || {};

    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    const ok = await verifyPinHelper(restaurant, pin);
    if (!ok) return next(createHttpError(401, "PIN verification required to update Store Properties."));

    // Owner-Only Action check: changing owner contact details
    if (
      (props.ownerName !== undefined || props.ownerPhone !== undefined || props.ownerEmail !== undefined) &&
      req.user.role !== "Owner" && req.user.role !== "owner" && req.user.role !== "superadmin"
    ) {
      return next(createHttpError(403, "Only the Store Owner can modify owner contact information."));
    }

    const oldProps = {
      storeName: restaurant.name,
      ownerName: restaurant.ownerName,
      ownerPhone: restaurant.ownerPhone,
      address: restaurant.address,
    };

    if (props.storeName) restaurant.name = String(props.storeName).trim();
    if (props.ownerName !== undefined) restaurant.ownerName = String(props.ownerName).trim();
    if (props.ownerPhone !== undefined) restaurant.ownerPhone = String(props.ownerPhone).trim();
    if (props.contactPersonPhone !== undefined) restaurant.contactPersonPhone = String(props.contactPersonPhone).trim();
    if (props.ownerEmail !== undefined) restaurant.ownerEmail = String(props.ownerEmail).trim();
    if (props.fssaiNumber !== undefined) restaurant.fssaiNumber = String(props.fssaiNumber).trim();
    if (props.gstNumber !== undefined) restaurant.taxId = String(props.gstNumber).trim();
    if (props.googleMapsLink !== undefined) restaurant.mapsLink = String(props.googleMapsLink).trim();
    // One logo for the whole store: the POS, receipts, the table QR page and
    // the website all show it, so it is written to both places it is read from.
    let logoChanged = false;
    if (props.restaurantLogo !== undefined) {
      const logo = cleanImageUrl(props.restaurantLogo);
      if (String(props.restaurantLogo || "").trim() && !logo) {
        return next(createHttpError(400, "The logo must be an uploaded image."));
      }
      restaurant.branding = restaurant.branding || {};
      logoChanged = (restaurant.branding.logo || "") !== logo;
      restaurant.branding.logo = logo;
    }

    restaurant.address = restaurant.address || {};
    if (props.fullAddress !== undefined) restaurant.address.line1 = String(props.fullAddress).trim();
    if (props.secondAddress !== undefined) restaurant.address.line2 = String(props.secondAddress).trim();
    if (props.city !== undefined) restaurant.address.city = String(props.city).trim();
    if (props.postalCode !== undefined) restaurant.address.postalCode = String(props.postalCode).trim();
    if (props.latitude !== undefined) restaurant.address.lat = Number(props.latitude) || null;
    if (props.longitude !== undefined) restaurant.address.lng = Number(props.longitude) || null;

    await restaurant.save();

    if (props.restaurantLogo !== undefined) {
      const logo = restaurant.branding.logo;
      const settings = await WebsiteSettings.findOne({ restaurantId: restaurant._id, isDeleted: false });
      if (settings && (logoChanged || (settings.branding?.logo?.url || "") !== logo)) {
        settings.branding.logo = { mediaId: null, url: logo, thumbnailUrl: logo, alt: logo ? `${restaurant.name} logo` : "" };
        await settings.save();
      }
    }

    await logActivity({
      req,
      action: "Updated Store Properties",
      resource: "Store Details",
      previousValue: oldProps,
      newValue: {
        storeName: restaurant.name,
        ownerName: restaurant.ownerName,
        ownerPhone: restaurant.ownerPhone,
        address: restaurant.address,
      },
      description: "Store Properties updated",
    });

    res.status(200).json({ success: true, message: "Store Properties updated!", data: restaurant });
  } catch (error) {
    next(error);
  }
};

// Module 7 §3 — Update POS Settings
const updatePosSettings = async (req, res, next) => {
  try {
    const body = req.body || {};

    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    // Only the fields sent are changed, so one section of the screen saving
    // cannot reset another.
    const updated = receiptSettingsOf(restaurant);
    if ("autoEBill" in body) updated.autoEBill = Boolean(body.autoEBill);
    if ("customMessage" in body) updated.customMessage = String(body.customMessage || "").trim().slice(0, 300);
    if ("showWebsiteLink" in body) updated.showWebsiteLink = Boolean(body.showWebsiteLink);
    if ("websiteLink" in body) {
      updated.websiteLink = cleanWebsiteLink(body.websiteLink);
      if (String(body.websiteLink || "").trim() && !updated.websiteLink) {
        return next(createHttpError(400, "Enter the website link as an address, e.g. www.yourrestaurant.com"));
      }
    }
    if ("showQrCode" in body) updated.showQrCode = Boolean(body.showQrCode);
    if ("qrCodeImage" in body) updated.qrCodeImage = cleanImageUrl(body.qrCodeImage);
    if ("showLogo" in body) updated.showLogo = Boolean(body.showLogo);
    if (updated.showQrCode && !updated.qrCodeImage) {
      return next(createHttpError(400, "Upload the website QR code image before turning it on."));
    }

    restaurant.posSettings = { ...updated, autoPrintReceipt: restaurant.posSettings?.autoPrintReceipt ?? true };
    await restaurant.save();

    res.status(200).json({ success: true, message: "POS Settings updated!", data: receiptSettingsOf(restaurant) });
  } catch (error) {
    next(error);
  }
};

// Module 7 §4 — Order Type Toggles
const updateOrderToggles = async (req, res, next) => {
  try {
    const { collection, delivery, table } = req.body || {};

    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    restaurant.orderTypeToggles = {
      collection: Boolean(collection),
      delivery: Boolean(delivery),
      table: Boolean(table),
    };
    await restaurant.save();

    // Also update WebsiteSettings.ordering pickupEnabled/deliveryEnabled for storefront consistency
    await WebsiteSettings.findOneAndUpdate(
      { restaurantId: restaurant._id, isDeleted: false },
      {
        $set: {
          "ordering.pickupEnabled": Boolean(collection),
          "ordering.deliveryEnabled": Boolean(delivery),
        },
      }
    );

    res.status(200).json({ success: true, message: "Order Type Toggles updated!", data: restaurant.orderTypeToggles });
  } catch (error) {
    next(error);
  }
};

// Module 7 §6 — Timings Management
const updateChannelTimings = async (req, res, next) => {
  try {
    const { channel, data, channelHours } = req.body || {};
    const restaurantId = req.user.restaurantId || req.user._id;

    let update = {};
    if (channel && ["collection", "delivery", "table"].includes(channel)) {
      update[`channelHours.${channel}`] = data;
    } else if (channelHours) {
      update.channelHours = channelHours;
    }

    const settings = await WebsiteSettings.findOneAndUpdate(
      { restaurantId, isDeleted: false },
      { $set: update },
      { new: true, upsert: false }
    );

    res.status(200).json({ success: true, message: "Store Timings updated!", data: settings?.channelHours });
  } catch (error) {
    next(error);
  }
};

// Module 7 §7 — Holidays Management
const updateHolidays = async (req, res, next) => {
  try {
    const { holidays } = req.body || {};
    const restaurantId = req.user.restaurantId || req.user._id;

    const cleanHolidays = (Array.isArray(holidays) ? holidays : []).map((h) => ({
      startDate: new Date(h.startDate),
      endDate: new Date(h.endDate),
      reason: String(h.reason || "Store Closed for Holiday").trim(),
    }));

    const settings = await WebsiteSettings.findOneAndUpdate(
      { restaurantId, isDeleted: false },
      { $set: { holidays: cleanHolidays } },
      { new: true }
    );

    res.status(200).json({ success: true, message: "Holidays updated!", data: settings?.holidays });
  } catch (error) {
    next(error);
  }
};

// Module 7 — Closed for Today Override
const toggleClosedForToday = async (req, res, next) => {
  try {
    const { enabled, date, reason } = req.body || {};
    const restaurantId = req.user.restaurantId || req.user._id;

    // "Today" in the restaurant's timezone. The server runs in UTC, so its own
    // date was a day behind for the first 5.5 hours of every Indian day and
    // Close for Today switched on after midnight closed yesterday instead.
    const { localDate } = require("../services/tableBookings");
    const restaurant = await Restaurant.findById(req.user.restaurantId).select("timezone").lean().catch(() => null);
    const todayStr = localDate(new Date(), restaurant?.timezone || "Asia/Kolkata");

    const updateData = {
      closedForToday: {
        enabled: Boolean(enabled),
        date: todayStr,
        reason: reason || "Closed for Today",
      },
    };

    const settings = await WebsiteSettings.findOneAndUpdate(
      { restaurantId, isDeleted: false },
      { $set: updateData },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: enabled ? "Store set to Closed for Today!" : "Closed for Today disabled. Normal schedule resumed.",
      data: settings?.closedForToday,
    });
  } catch (error) {
    next(error);
  }
};

// Roles the owner can give from Manage Staff. A Manager can also refund
// (middlewares/requirePermission.js requireManager); Staff and Cashier differ
// only in name. Everyone but the owner needs the Security PIN for protected
// actions.
const STAFF_ROLES = ["Staff", "Cashier", "Manager"];
// Every account on the store the owner manages: anyone who is not the owner.
// Refuses without a store: `restaurantId: undefined` is dropped from a
// Mongoose filter, which would match users of every store.
const managedStaff = (restaurantId) => {
  if (!restaurantId) throw createHttpError(403, "This account is not linked to a store.");
  return {
    restaurantId,
    role: { $nin: ["Owner", "owner", "superadmin"] },
    isDeleted: { $ne: true },
  };
};

// Module 7 §8 / §9 — Manage Staff (Owner only)
const addStaffMember = async (req, res, next) => {
  try {
    if (req.user.role !== "Owner" && req.user.role !== "owner") {
      return next(createHttpError(403, "Only the store owner can add staff members."));
    }

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");
    const role = req.body.role === undefined ? "Staff" : req.body.role;
    if (!STAFF_ROLES.includes(role)) {
      return next(createHttpError(400, `Role must be one of: ${STAFF_ROLES.join(", ")}.`));
    }

    if (!name || phone.length !== 10) {
      return next(createHttpError(400, "Staff name and a 10-digit phone number are required."));
    }

    const restaurantId = req.user.restaurantId;
    const existing = await User.findOne({ phone, restaurantId, isDeleted: { $ne: true } });
    if (existing) {
      return next(createHttpError(400, "A staff member with this phone number already exists."));
    }

    // The staff member chooses their own password at first sign-in, so the
    // row is seeded with an unusable random value and flagged as a
    // placeholder. It used to be seeded with bcrypt(phone + "KnotKitchenPass")
    // assigned to `password`, which the pre-save hook then hashed AGAIN --
    // so it was neither guessable nor knowable, and staff could not sign in
    // at all.
    const randomPassword = require("crypto").randomBytes(32).toString("hex");
    const defaultPinHash = bcrypt.hashSync(DEFAULT_PIN, 10);

    const staff = await User.create({
      name,
      phone,
      address: "Staff Address",
      password: randomPassword,
      role,
      restaurantId,
      storeId: req.user.storeId,
      isActive: true,
      // Nobody holds this password: /store/login sends them to Create
      // Password instead of failing them, and the flag is cleared the moment
      // they set one.
      passwordPlaceholder: true,
      permissions: ["orders.read", "orders.write"], // Basic non-privileged permissions
    });

    await logActivity({
      req,
      action: "Staff Member Created",
      resource: "Staff",
      entityType: "User",
      entityId: staff._id,
      newValue: { name: staff.name, phone: staff.phone, role: staff.role },
      description: `Staff member created: ${name} (${phone})`,
    });

    res.status(201).json({ success: true, message: "Staff member added successfully!", data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const getStaffMembers = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId || req.user._id;
    const staff = await User.find(managedStaff(restaurantId));
    res.status(200).json({ success: true, data: staff.map((s) => s.toSafeJSON()) });
  } catch (error) {
    next(error);
  }
};

const deleteStaffMember = async (req, res, next) => {
  try {
    if (req.user.role !== "Owner" && req.user.role !== "owner") {
      return next(createHttpError(403, "Only the store owner can delete staff members."));
    }

    const { staffId } = req.params;
    const staff = await User.findOneAndUpdate(
      { _id: staffId, ...managedStaff(req.user.restaurantId) },
      { isDeleted: true, isActive: false },
      { new: true }
    );
    if (!staff) return next(createHttpError(404, "Staff member not found."));

    await logActivity({
      req,
      action: "Staff Member Deleted",
      resource: "Staff",
      entityType: "User",
      entityId: staff._id,
      previousValue: { name: staff.name, phone: staff.phone, role: staff.role },
      description: `Staff member deleted: ${staff.name} (${staff.phone})`,
    });

    res.status(200).json({ success: true, message: "Staff member deleted!" });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/restaurant/staff/:staffId  { role } -- Owner only. */
const updateStaffRole = async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!STAFF_ROLES.includes(role)) {
      return next(createHttpError(400, `Role must be one of: ${STAFF_ROLES.join(", ")}.`));
    }
    const staff = await User.findOne({ _id: req.params.staffId, ...managedStaff(req.user.restaurantId) });
    if (!staff) return next(createHttpError(404, "Staff member not found."));
    const previousRole = staff.role;
    staff.role = role;
    await staff.save();

    await logActivity({
      req,
      action: "Staff Role Changed",
      resource: "Staff",
      entityType: "User",
      entityId: staff._id,
      previousValue: { role: previousRole },
      newValue: { role },
      description: `Staff role changed: ${staff.name} (${staff.phone}) ${previousRole} -> ${role}`,
    });

    res.status(200).json({ success: true, message: "Role updated.", data: staff.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  STAFF_ROLES,
  updateStaffRole,
  getMyRestaurant,
  getStoreProperties,
  updateStoreProperties,
  verifyPin,
  changePin,
  updatePosSettings,
  updateOrderToggles,
  updateChannelTimings,
  updateHolidays,
  toggleClosedForToday,
  addStaffMember,
  getStaffMembers,
  deleteStaffMember,
  verifyPinHelper,
};


