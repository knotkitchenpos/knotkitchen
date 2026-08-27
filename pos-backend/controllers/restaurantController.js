const createHttpError = require("http-errors");
const Restaurant = require("../models/restaurantModel");
const Outlet = require("../models/outletModel");
const Team = require("../models/teamModel");
const User = require("../models/userModel");
const AuditLog = require("../models/auditLogModel");

// ===== Restaurant Onboarding =====
const onboardRestaurant = async (req, res, next) => {
  try {
    const { name, legalName, registrationNumber, taxId, currency, timezone, address } = req.body;

    if (!name) {
      const error = createHttpError(400, "Restaurant name is required!");
      return next(error);
    }

    // Check if user already has a restaurant
    const existingRestaurant = await Restaurant.findOne({
      ownerId: req.user._id,
      isDeleted: false,
    });
    if (existingRestaurant) {
      const error = createHttpError(400, "You already have a restaurant registered!");
      return next(error);
    }

    // Create restaurant
    const restaurant = await Restaurant.create({
      name,
      legalName: legalName || name,
      registrationNumber,
      taxId,
      currency: currency || "INR",
      timezone: timezone || "Asia/Kolkata",
      address: address || {},
      ownerId: req.user._id,
      subscription: {
        plan: "starter",
        status: "trial",
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
      },
    });

    // Link restaurant to user
    await User.findByIdAndUpdate(req.user._id, { restaurantId: restaurant._id });

    // Create default outlet
    const defaultOutlet = await Outlet.create({
      restaurantId: restaurant._id,
      name: "Main Outlet",
      code: "MAIN-01",
      address: address || {},
    });

    // Create default team
    const defaultTeam = await Team.create({
      name: "Owners",
      description: "Default owner team",
      restaurantId: restaurant._id,
      outletId: defaultOutlet._id,
      managerId: req.user._id,
      members: [req.user._id],
      permissions: ["*"], // Full access
    });

    // Audit log
    await AuditLog.create({
      userId: req.user._id,
      restaurantId: restaurant._id,
      action: "RESTAURANT.CREATE",
      resource: "Restaurant",
      resourceId: restaurant._id,
      description: `Restaurant onboarded: ${name}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      success: true,
      message: "Restaurant onboarded successfully!",
      data: { restaurant, defaultOutlet, defaultTeam },
    });
  } catch (error) {
    next(error);
  }
};

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

const updateRestaurant = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const update = { ...req.body };
    delete update.ownerId;
    delete update.isDeleted;

    // Verify ownership
    const restaurant = await Restaurant.findOneAndUpdate(
      { _id: restaurantId, ownerId: req.user._id },
      update,
      { new: true }
    );
    if (!restaurant) {
      const error = createHttpError(404, "Restaurant not found!");
      return next(error);
    }

    await AuditLog.create({
      userId: req.user._id,
      restaurantId: restaurant._id,
      action: "RESTAURANT.UPDATE",
      resource: "Restaurant",
      resourceId: restaurant._id,
      description: `Restaurant updated: ${restaurant.name}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({ success: true, message: "Restaurant updated!", data: restaurant });
  } catch (error) {
    next(error);
  }
};

// ===== Outlet Management =====
const addOutlet = async (req, res, next) => {
  try {
    const { restaurantId, name, code, address, phone, email } = req.body;
    if (!restaurantId || !name || !code) {
      const error = createHttpError(400, "Restaurant ID, outlet name and code are required!");
      return next(error);
    }

    // Verify restaurant ownership
    const restaurant = await Restaurant.findOne({
      _id: restaurantId,
      ownerId: req.user._id,
    });
    if (!restaurant) {
      const error = createHttpError(403, "Not authorized for this restaurant!");
      return next(error);
    }

    const outlet = await Outlet.create({
      restaurantId,
      name,
      code,
      address: address || {},
      phone,
      email,
    });

    await AuditLog.create({
      userId: req.user._id,
      restaurantId,
      action: "OUTLET.CREATE",
      resource: "Outlet",
      resourceId: outlet._id,
      description: `Outlet created: ${name}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({ success: true, message: "Outlet added!", data: outlet });
  } catch (error) {
    next(error);
  }
};

const getOutlets = async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    const outlets = await Outlet.find({ restaurantId, isDeleted: false });
    res.status(200).json({ success: true, data: outlets });
  } catch (error) {
    next(error);
  }
};

const updateOutlet = async (req, res, next) => {
  try {
    const { outletId } = req.params;
    const outlet = await Outlet.findOneAndUpdate(
      { _id: outletId, isDeleted: false },
      req.body,
      { new: true }
    );
    if (!outlet) {
      const error = createHttpError(404, "Outlet not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Outlet updated!", data: outlet });
  } catch (error) {
    next(error);
  }
};

const deleteOutlet = async (req, res, next) => {
  try {
    const { outletId } = req.params;
    const outlet = await Outlet.findOneAndUpdate(
      { _id: outletId },
      { isDeleted: true },
      { new: true }
    );
    if (!outlet) {
      const error = createHttpError(404, "Outlet not found!");
      return next(error);
    }
    res.status(200).json({ success: true, message: "Outlet deleted!" });
  } catch (error) {
    next(error);
  }
};

// ===== Franchise =====
const getFranchiseOverview = async (req, res, next) => {
  try {
    const restaurant = await Restaurant.findOne({
      ownerId: req.user._id,
      isDeleted: false,
    });
    if (!restaurant) {
      const error = createHttpError(404, "No restaurant found!");
      return next(error);
    }

    const outlets = await Outlet.find({ restaurantId: restaurant._id, isDeleted: false });
    const teams = await Team.find({ restaurantId: restaurant._id, isDeleted: false });

    res.status(200).json({
      success: true,
      data: {
        restaurant,
        outletCount: outlets.length,
        outlets,
        teamCount: teams.length,
        teams,
      },
    });
  } catch (error) {
    next(error);
  }
};

const bcrypt = require("bcrypt");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { logActivity } = require("../services/auditService");

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
        restaurantLogo: restaurant.branding?.logo || settings?.branding?.logo?.url || "",
        posSettings: restaurant.posSettings || { autoPrintReceipt: true, autoEBill: false, customMessage: "Thank you for visiting us!", websiteLink: "" },
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
    if (!ok) return next(createHttpError(401, "Invalid Security PIN. Default PIN is 8796."));

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
    if (props.restaurantLogo !== undefined) {
      restaurant.branding = restaurant.branding || {};
      restaurant.branding.logo = String(props.restaurantLogo).trim();
    }

    restaurant.address = restaurant.address || {};
    if (props.fullAddress !== undefined) restaurant.address.line1 = String(props.fullAddress).trim();
    if (props.secondAddress !== undefined) restaurant.address.line2 = String(props.secondAddress).trim();
    if (props.city !== undefined) restaurant.address.city = String(props.city).trim();
    if (props.postalCode !== undefined) restaurant.address.postalCode = String(props.postalCode).trim();
    if (props.latitude !== undefined) restaurant.address.lat = Number(props.latitude) || null;
    if (props.longitude !== undefined) restaurant.address.lng = Number(props.longitude) || null;

    await restaurant.save();

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
    const { autoPrintReceipt, autoEBill, customMessage, websiteLink } = req.body || {};

    const restaurant = await Restaurant.findOne({
      ...(req.user.restaurantId ? { _id: req.user.restaurantId } : { ownerId: req.user._id }),
      isDeleted: false,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    restaurant.posSettings = {
      autoPrintReceipt: Boolean(autoPrintReceipt),
      autoEBill: Boolean(autoEBill),
      customMessage: String(customMessage || "").trim().slice(0, 300),
      websiteLink: String(websiteLink || "").trim().slice(0, 200),
    };
    await restaurant.save();

    res.status(200).json({ success: true, message: "POS Settings updated!", data: restaurant.posSettings });
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

    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const todayStr = `${y}-${m}-${d}`;

    const updateData = {
      closedForToday: {
        enabled: Boolean(enabled),
        date: date || todayStr,
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

// Module 7 §8 / §9 — Manage Staff (Owner only)
const addStaffMember = async (req, res, next) => {
  try {
    if (req.user.role !== "Owner" && req.user.role !== "owner") {
      return next(createHttpError(403, "Only the store owner can add staff members."));
    }

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/\D/g, "");

    if (!name || phone.length !== 10) {
      return next(createHttpError(400, "Staff name and a 10-digit phone number are required."));
    }

    const restaurantId = req.user.restaurantId;
    const existing = await User.findOne({ phone, restaurantId, isDeleted: { $ne: true } });
    if (existing) {
      return next(createHttpError(400, "A staff member with this phone number already exists."));
    }

    // Default password / pin setup
    const randomPassword = bcrypt.hashSync(phone + "KnotKitchenPass", 10);
    const defaultPinHash = bcrypt.hashSync(DEFAULT_PIN, 10);

    const staff = await User.create({
      name,
      phone,
      address: "Staff Address",
      password: randomPassword,
      role: "Staff",
      restaurantId,
      storeId: req.user.storeId,
      isActive: true,
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
    const staff = await User.find({ restaurantId, role: "Staff", isDeleted: { $ne: true } });
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
      { _id: staffId, restaurantId: req.user.restaurantId, role: "Staff" },
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

const getActivityLogs = async (req, res, next) => {
  try {
    const restaurantId = req.user.restaurantId || req.user._id;
    const { page = 1, limit = 50, date, phone, action, resource } = req.query;

    const filter = {
      $or: [{ restaurantId }, { storeId: req.user.storeId }],
    };

    if (phone) filter.phone = new RegExp(String(phone).trim(), "i");
    if (action) filter.action = new RegExp(String(action).trim(), "i");
    if (resource) filter.resource = new RegExp(String(resource).trim(), "i");
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      filter.createdAt = { $gte: start, $lte: end };
    }

    const p = Math.max(1, parseInt(page, 10));
    const l = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((p - 1) * l).limit(l),
      AuditLog.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: logs,
      pagination: { total, page: p, pages: Math.ceil(total / l), limit: l },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  onboardRestaurant,
  getMyRestaurant,
  updateRestaurant,
  addOutlet,
  getOutlets,
  updateOutlet,
  deleteOutlet,
  getFranchiseOverview,
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
  getActivityLogs,
  verifyPinHelper,
};


