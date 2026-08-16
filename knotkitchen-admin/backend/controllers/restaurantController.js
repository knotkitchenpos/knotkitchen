const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const createHttpError = require("http-errors");

const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const Store = require("../models/storeModel");

const config = require("../config/config");

/**
 * Admin portal store-creation flow.
 *
 * SECURITY POSTURE (§29):
 *   - All routes here are already behind isAdminVerified. The role guard
 *     (requireAdminRole("superadmin")) is applied at the route level so
 *     "support" role admins cannot create/delete/suspend stores.
 *   - OTPs are:
 *       * generated with crypto.randomInt (uniform, unpredictable)
 *       * hashed in-memory (never stored as plaintext)
 *       * NEVER returned in the API response — the pre-fix version echoed
 *         the code back, defeating the whole point of an OTP
 *       * gated by a per-phone TTL and attempt counter
 *   - The "accept 123456 as universal OTP" bypass has been removed. In
 *     development, the operator can set ALLOW_DEV_OTP=true + OTP_DEV_CODE
 *     to opt in explicitly.
 *   - No user record is ever seeded with a hardcoded password. The owner
 *     account is created with a strong random secret; the owner must sign
 *     in via the POS OTP flow (the intended UX) or reset the password.
 */

// Read at request time (not at module load) so tests that set env vars
// dynamically pick up the change. Never active in production.
const devOtpAllowed = () => !config.isProduction && process.env.ALLOW_DEV_OTP === "true";
const devOtpCode = () => process.env.OTP_DEV_CODE || "123456";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

// In-memory OTP store — swap for Redis when horizontally scaling. Each entry:
//   { otpHash, expiresAt, attempts, storeName, ownerName }
const storeOtpMap = new Map();

const maskPhone = (phone) => {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return "***";
  return `${d.slice(0, 2)}${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-2)}`;
};

const generateStoreOtp = () => {
  if (devOtpAllowed()) return String(devOtpCode());
  return String(crypto.randomInt(100000, 1000000));
};

const generateUniqueStoreId = async () => {
  for (let i = 0; i < 100; i += 1) {
    const storeId = String(crypto.randomInt(100000, 1000000));
    // Check both collections to avoid collisions with pos-backend registrations.
    // Bare findOne (no .lean().select() chaining) keeps this compatible with
    // plain-object mocks used in unit tests.
    const [existingStore, existingRestaurant] = await Promise.all([
      Store.findOne({ storeId }),
      Restaurant.findOne({ storeId }),
    ]);
    if (!existingStore && !existingRestaurant) return storeId;
  }
  throw new Error("Failed to generate unique Store ID");
};

/**
 * POST /admin/stores/send-otp
 *
 * SECURITY:
 *   - Response body carries ONLY the masked phone. It NEVER echoes the code.
 *   - The OTP is hashed before being cached (§22).
 *   - Attempts / expiry are tracked so brute-force is bounded.
 */
const sendStoreCreationOtp = async (req, res, next) => {
  try {
    const storeName = String(req.body?.storeName || "").trim();
    const ownerName = String(req.body?.ownerName || "").trim();
    const ownerPhoneRaw = String(req.body?.ownerPhone || "").trim();

    if (!storeName || !ownerName || !ownerPhoneRaw) {
      return next(createHttpError(400, "Store Name, Owner Name, and Owner Phone Number are required!"));
    }
    if (!/^\d{10}$/.test(ownerPhoneRaw)) {
      return next(createHttpError(400, "Owner phone number must be exactly 10 digits!"));
    }

    const existingStore = await Store.findOne({ storeName, isDeleted: { $ne: true } });
    if (existingStore) return next(createHttpError(400, "A store with this name already exists!"));

    const existingPhone = await Store.findOne({ ownerPhone: ownerPhoneRaw, isDeleted: { $ne: true } });
    if (existingPhone) {
      return next(createHttpError(400, "This owner phone number is already associated with another store!"));
    }

    const otp = generateStoreOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    storeOtpMap.set(ownerPhoneRaw, {
      otpHash,
      expiresAt: Date.now() + OTP_TTL_MS,
      attempts: 0,
      storeName,
      ownerName,
    });

    // In dev with ALLOW_DEV_OTP the operator can read the code from stdout.
    if (!config.isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[admin:otp] ${maskPhone(ownerPhoneRaw)}: ${otp}`);
    }

    res.status(200).json({
      success: true,
      message: `OTP sent to registered phone ${maskPhone(ownerPhoneRaw)}.`,
      data: { phone: maskPhone(ownerPhoneRaw) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /admin/stores
 *
 * Creates the Store + Restaurant + Owner user after OTP verification.
 *
 * SECURITY vs. pre-fix behaviour:
 *   - No universal "123456" fallback. The provided OTP is verified via bcrypt
 *     against the hash from storeOtpMap.
 *   - Owner user password is now random (32 bytes base64url) — the owner
 *     completes signup via the POS OTP flow (which sets the real password),
 *     never via a well-known default like the old `"123456"`.
 */
const createStore = async (req, res, next) => {
  try {
    const storeName = String(req.body?.storeName || "").trim();
    const ownerName = String(req.body?.ownerName || "").trim();
    const ownerPhone = String(req.body?.ownerPhone || "").trim();
    const otp = String(req.body?.otp || "").trim();

    if (!storeName || !ownerName || !ownerPhone || !otp) {
      return next(createHttpError(400, "Store Name, Owner Name, Owner Phone, and OTP are required!"));
    }
    if (!/^\d{10}$/.test(ownerPhone)) {
      return next(createHttpError(400, "Owner phone number must be exactly 10 digits!"));
    }

    // Dev-only bypass. Refuses to activate in production regardless of what
    // env vars are set — see config.isProduction. This mirrors the pos-backend
    // helper so both apps behave the same way during local development / CI.
    const devBypass = devOtpAllowed() && otp === devOtpCode();

    if (!devBypass) {
      const cached = storeOtpMap.get(ownerPhone);
      if (!cached) return next(createHttpError(400, "Invalid or expired OTP. Please request a new OTP."));
      if (cached.expiresAt < Date.now()) {
        storeOtpMap.delete(ownerPhone);
        return next(createHttpError(400, "Invalid or expired OTP. Please request a new OTP."));
      }
      if (cached.attempts >= OTP_MAX_ATTEMPTS) {
        storeOtpMap.delete(ownerPhone);
        return next(createHttpError(429, "Too many attempts. Please request a new OTP."));
      }

      const isValid = await bcrypt.compare(otp, cached.otpHash);
      cached.attempts += 1;
      if (!isValid) {
        return next(createHttpError(400, "Invalid OTP code!"));
      }
      // One-shot: consume the OTP so it cannot be replayed.
      storeOtpMap.delete(ownerPhone);
    }

    const existingStore = await Store.findOne({ storeName, isDeleted: { $ne: true } });
    if (existingStore) return next(createHttpError(400, "A store with this name already exists!"));

    const storeId = await generateUniqueStoreId();

    // 1. Create Restaurant record
    const restaurant = await Restaurant.create({
      name: storeName,
      storeId,
      phone: ownerPhone,
      address: { line1: "Default Address" },
      isVerified: true,
      isApproved: true,
      subscriptionStatus: "ACTIVE",
    });

    // 2. Create Owner User with a RANDOM strong password. The owner completes
    //    signup by using the POS OTP flow, which sets their real password (or
    //    they can request a password reset). This removes the well-known
    //    default "123456" that the previous version used.
    const randomPassword = crypto.randomBytes(24).toString("base64url");
    const passwordHash = await bcrypt.hash(randomPassword, 10);
    const ownerUser = await User.create({
      name: ownerName,
      phone: ownerPhone,
      address: "Default Store Address",
      password: passwordHash,
      role: "Owner",
      restaurantId: restaurant._id,
      isVerified: true,
      // Email intentionally omitted — the pre-fix `${cleanPhone}@knotkitchen.com`
      // shape was fake and could cause conflicts / notification errors.
    });

    restaurant.ownerId = ownerUser._id;
    await restaurant.save();

    // 3. Create Store record linked to Restaurant
    const newStore = await Store.create({
      storeId,
      storeName,
      ownerName,
      ownerPhone,
      restaurantId: restaurant._id,
      status: "active",
    });

    // 4. Provision customer-facing website (best-effort)
    let websiteSettings = null;
    try {
      const {
        provisionWebsiteForStore,
        buildStorefrontUrl,
      } = require("../services/websiteProvisioningService");
      websiteSettings = await provisionWebsiteForStore({
        storeId,
        storeName,
        restaurantId: restaurant._id,
        contact: { phone: ownerPhone },
      });
      if (websiteSettings) {
        websiteSettings = {
          slug: websiteSettings.slug,
          enabled: websiteSettings.enabled,
          url: buildStorefrontUrl(websiteSettings),
        };
      }
    } catch (provisionError) {
      console.warn("Website provisioning failed for store", storeId, provisionError.message);
    }

    res.status(201).json({
      success: true,
      message: "Store authenticated and created successfully!",
      data: {
        _id: newStore._id,
        storeId: newStore.storeId,
        storeName: newStore.storeName,
        ownerName: newStore.ownerName,
        ownerPhone: maskPhone(newStore.ownerPhone),
        status: newStore.status,
        createdAt: newStore.createdAt,
        website: websiteSettings,
      },
    });
  } catch (error) {
    next(error);
  }
};

const updateStoreStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, closedUntil, closureReason } = req.body || {};

    const store = await Store.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!store) return next(createHttpError(404, "Store not found!"));

    switch (action) {
      case "close_temporarily":
        store.status = "closed_temporarily";
        store.closedUntil = undefined;
        store.closureReason = String(closureReason || "Closed temporarily by administrator").slice(0, 300);
        break;
      case "close_until": {
        if (!closedUntil) return next(createHttpError(400, "Close date/time is required!"));
        const when = new Date(closedUntil);
        if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
          return next(createHttpError(400, "Close-until must be a valid future date."));
        }
        store.status = "closed_until";
        store.closedUntil = when;
        store.closureReason = String(closureReason || `Closed until ${when.toLocaleString()}`).slice(0, 300);
        break;
      }
      case "activate":
        store.status = "active";
        store.closedUntil = undefined;
        store.closureReason = "";
        break;
      case "suspend":
        store.status = "suspended";
        break;
      default:
        return next(createHttpError(400, "Invalid action specified"));
    }

    await store.save();

    res.status(200).json({
      success: true,
      message: `Store status updated to ${store.status}!`,
      data: store,
    });
  } catch (error) {
    next(error);
  }
};

const deleteStore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const store = await Store.findById(id);
    if (!store) return next(createHttpError(404, "Store not found!"));

    store.isDeleted = true;
    store.status = "deleted";
    await store.save();

    res.status(200).json({
      success: true,
      message: "Store deleted successfully!",
      data: { id: store._id, storeId: store.storeId },
    });
  } catch (error) {
    next(error);
  }
};

const getAllStores = async (req, res, next) => {
  try {
    const stores = await Store.find({ isDeleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(1000);
    res.status(200).json({ success: true, data: stores });
  } catch (error) {
    next(error);
  }
};

const getAllRestaurants = async (req, res, next) => {
  try {
    const restaurants = await Restaurant.find({ isDeleted: { $ne: true } })
      .limit(1000)
      .populate("ownerId", "name email phone role lastLoginAt isActive createdAt");

    const data = await Promise.all(
      restaurants.map(async (r) => {
        const [menuCount, orderCount, staffCount, tableCount, todayOrders] = await Promise.all([
          Menu.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Order.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          User.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Table.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Order.countDocuments({
            restaurantId: r._id,
            orderDate: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          }),
        ]);

        const start = new Date();
        start.setMonth(start.getMonth() - 1);

        const lastMonth = await Order.aggregate([
          { $match: { restaurantId: r._id, orderDate: { $gte: start }, isDeleted: { $ne: true } } },
          { $group: { _id: null, revenue: { $sum: "$bills.totalWithTax" }, orders: { $sum: 1 } } },
        ]);

        return {
          ...r.toObject(),
          stats: {
            revenue30d: lastMonth[0]?.revenue || 0,
            orders30d: lastMonth[0]?.orders || 0,
            todayOrders,
            menuCount,
            orderCount,
            staffCount,
            tableCount,
          },
        };
      })
    );

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

const getRestaurantDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurant = await Restaurant.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      "ownerId",
      "name email phone role lastLoginAt isActive createdAt"
    );
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    const [menus, orders, tables, staff] = await Promise.all([
      Menu.find({ restaurantId: id, isDeleted: { $ne: true } }).limit(500),
      Order.find({ restaurantId: id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(50),
      Table.find({ restaurantId: id, isDeleted: { $ne: true } }).limit(500),
      User.find({ restaurantId: id, isDeleted: { $ne: true } })
        .select("-password -sessions -mfa -resetPasswordToken -emailVerificationToken")
        .limit(500),
    ]);

    res.status(200).json({
      success: true,
      data: { restaurant, menus, orders, tables, staff },
    });
  } catch (error) {
    next(error);
  }
};

const toggleRestaurantStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const restaurant = await Restaurant.findById(id);
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    restaurant.isActive = !restaurant.isActive;
    await restaurant.save();

    if (restaurant.ownerId) {
      await User.updateOne({ _id: restaurant.ownerId }, { isActive: restaurant.isActive });
    }

    res.status(200).json({
      success: true,
      message: `Restaurant ${restaurant.isActive ? "activated" : "deactivated"} successfully!`,
      data: restaurant,
    });
  } catch (error) {
    next(error);
  }
};

const updateRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body || {};

    // Strict allow-list — every other field (including `storeId`, `ownerId`,
    // `subscriptionStatus`, `isDeleted`, ...) is IGNORED to prevent mass
    // assignment (§29). Complex objects like `address` are permitted as-is
    // because they're validated by the Restaurant schema.
    const allowedFields = [
      "name",
      "legalName",
      "registrationNumber",
      "taxId",
      "currency",
      "timezone",
      "address",
      "branding",
      "subscription",
    ];
    const filtered = {};
    for (const f of allowedFields) {
      if (updates[f] !== undefined) filtered[f] = updates[f];
    }

    const restaurant = await Restaurant.findByIdAndUpdate(id, filtered, {
      new: true,
      runValidators: true,
    });
    if (!restaurant) return next(createHttpError(404, "Restaurant not found!"));

    res.status(200).json({ success: true, message: "Restaurant updated!", data: restaurant });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendStoreCreationOtp,
  createStore,
  updateStoreStatus,
  deleteStore,
  getAllStores,
  getAllRestaurants,
  getRestaurantDetail,
  toggleRestaurantStatus,
  updateRestaurant,
};
