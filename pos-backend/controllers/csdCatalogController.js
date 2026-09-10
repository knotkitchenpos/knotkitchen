const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Menu = require("../models/menuModel");
const Table = require("../models/tableModel");
const User = require("../models/userModel");
const Store = require("../models/storeModel");
const WebsiteSettings = require("../models/websiteSettingsModel");
const { LANDING_TEMPLATES } = require("../models/websiteSettingsModel");
const { buildStorefrontUrl } = require("../services/websiteProvisioningService");
const { csdAudit } = require("../services/csdAuditService");

/**
 * Menus, Tables and Users for the CSD panel.
 *
 * These three were the only things the old Admin Portal could do that CSD
 * could not, and the reason it had to stay running. They are ported here so
 * the portal can be retired without losing capability.
 *
 * Two deliberate differences from the Admin Portal version:
 *
 *   1. Everything is addressed by the 6-digit storeId, not a Mongo ObjectId.
 *      That is the identifier CSD staff actually have in front of them — it is
 *      what the restaurant quotes on the phone — and it keeps every write
 *      scoped to one restaurant instead of operating on a global id.
 *
 *   2. Every write is audited. The Admin Portal changed prices and roles with
 *      no record of who did it; a support tool that can reprice a dish needs
 *      to answer "who changed this?".
 *
 * Reads are open to any signed-in staff member. Writes are admin-only, which
 * mirrors the Admin Portal's own superAdmin gate on exactly these operations.
 */

const str = (v) => String(v ?? "").trim();

/** Resolve a 6-digit storeId to its restaurant, or 404. */
const restaurantForStore = async (storeId) => {
  const id = str(storeId);
  if (!/^\d{6}$/.test(id)) throw createHttpError(400, "Store ID must be 6 digits.");

  const store = await Store.findOne({ storeId: id, isDeleted: { $ne: true } }).lean();
  if (!store) throw createHttpError(404, "Store not found.");

  const restaurantId = store.restaurantId;
  if (!restaurantId) throw createHttpError(409, "This store has no restaurant linked to it yet.");

  return { store, restaurantId };
};

const asObjectId = (val, field) => {
  if (!mongoose.Types.ObjectId.isValid(str(val))) {
    throw createHttpError(400, `Invalid ${field}.`);
  }
  return new mongoose.Types.ObjectId(str(val));
};

// --- Menus ------------------------------------------------------------------

const listMenus = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const menus = await Menu.find({ restaurantId, isDeleted: { $ne: true } })
      .limit(500)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        canEdit: req.csdStaff?.role === "admin",
        menus: menus.map((m) => ({
          id: m._id,
          name: m.name || "",
          category: m.category || "",
          published: Boolean(m.published ?? m.isPublished),
          publishedAt: m.publishedAt || null,
          itemCount: (m.items || []).length,
          items: (m.items || []).map((i) => ({
            id: i._id,
            name: i.name || "",
            price: i.price ?? 0,
            // Schema names: isAvailable / isVegetarian. Guessing "available"
            // and "isVeg" here would have reported every dish as available
            // and non-veg, with nothing to indicate it was wrong.
            isAvailable: i.isAvailable !== false,
            isVegetarian: Boolean(i.isVegetarian),
          })),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

/** Publish/unpublish decides whether the storefront shows the menu at all. */
const toggleMenuPublish = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const menu = await Menu.findOne({
      _id: asObjectId(req.params.menuId, "menu id"),
      restaurantId,
      isDeleted: { $ne: true },
    });
    if (!menu) return next(createHttpError(404, "Menu not found for this store."));

    menu.published = !menu.published;
    menu.isPublished = menu.published;
    if (menu.published) menu.publishedAt = new Date();
    // validateModifiedOnly: a full-document validate would reject the save
    // because of fields this edit never touched. Real rows predate later
    // schema additions, so an unrelated missing field would make an ordinary
    // support edit fail with a confusing 500 about something else entirely.
    await menu.save({ validateModifiedOnly: true });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_MENU_PUBLISH_TOGGLED",
      resource: "Menu", entityType: "Menu", entityId: menu._id,
      storeId: str(req.params.storeId),
      description: `Menu "${menu.name || menu._id}" ${menu.published ? "published" : "unpublished"}`,
      previousValue: { published: !menu.published }, newValue: { published: menu.published },
    });

    res.status(200).json({
      success: true,
      message: menu.published ? "Menu published." : "Menu unpublished.",
      data: { id: menu._id, published: menu.published },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Edit one dish. Deliberately narrow: name, price and availability only.
 * Variants, add-ons and modifiers are priced structures the POS owns — a
 * support tool that could rewrite them would be a good way to corrupt a live
 * menu during a phone call.
 */
const updateDish = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const menu = await Menu.findOne({
      _id: asObjectId(req.params.menuId, "menu id"),
      restaurantId,
      isDeleted: { $ne: true },
    });
    if (!menu) return next(createHttpError(404, "Menu not found for this store."));

    const item = menu.items.id(asObjectId(req.params.itemId, "item id"));
    if (!item) return next(createHttpError(404, "Dish not found."));

    const body = req.body || {};
    const before = { name: item.name, price: item.price, isAvailable: item.isAvailable };

    if (typeof body.name === "string") {
      const name = body.name.trim().slice(0, 200);
      if (!name) return next(createHttpError(400, "Dish name cannot be empty."));
      item.name = name;
    }
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0 || price > 1e7) {
        return next(createHttpError(400, "Price must be between 0 and 10,000,000."));
      }
      item.price = price;
    }
    if (typeof body.isAvailable === "boolean") item.isAvailable = body.isAvailable;

    // validateModifiedOnly: a full-document validate would reject the save
    // because of fields this edit never touched. Real rows predate later
    // schema additions, so an unrelated missing field would make an ordinary
    // support edit fail with a confusing 500 about something else entirely.
    await menu.save({ validateModifiedOnly: true });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_DISH_UPDATED",
      resource: "Menu", entityType: "MenuItem", entityId: item._id,
      storeId: str(req.params.storeId),
      description: `Dish "${before.name}" updated`,
      previousValue: before,
      newValue: { name: item.name, price: item.price, isAvailable: item.isAvailable },
    });

    res.status(200).json({
      success: true,
      data: { id: item._id, name: item.name, price: item.price, isAvailable: item.isAvailable },
    });
  } catch (err) {
    next(err);
  }
};

// --- Tables -----------------------------------------------------------------

const TABLE_STATUSES = ["available", "occupied", "reserved", "cleaning"];

const listTables = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const tables = await Table.find({ restaurantId, isDeleted: { $ne: true } })
      .sort({ tableNumber: 1 })
      .limit(500)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        canEdit: req.csdStaff?.role === "admin",
        statuses: TABLE_STATUSES,
        tables: tables.map((t) => ({
          id: t._id,
          tableNumber: t.tableNumber,
          capacity: t.capacity ?? 0,
          status: t.status || "available",
          zone: t.zone || "",
          qrEnabled: t.qrEnabled !== false,
          currentOccupancy: t.currentOccupancy ?? 0,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateTable = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const table = await Table.findOne({
      _id: asObjectId(req.params.tableId, "table id"),
      restaurantId,
      isDeleted: { $ne: true },
    });
    if (!table) return next(createHttpError(404, "Table not found for this store."));

    const body = req.body || {};
    const before = {
      status: table.status, capacity: table.capacity,
      zone: table.zone, qrEnabled: table.qrEnabled,
    };

    if (typeof body.status === "string") {
      if (!TABLE_STATUSES.includes(body.status)) {
        return next(createHttpError(400, `Status must be one of: ${TABLE_STATUSES.join(", ")}.`));
      }
      table.status = body.status;
    }
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        return next(createHttpError(400, "Capacity must be a whole number between 1 and 100."));
      }
      table.capacity = cap;
    }
    if (typeof body.zone === "string") table.zone = body.zone.trim().slice(0, 120);
    if (typeof body.qrEnabled === "boolean") table.qrEnabled = body.qrEnabled;

    await table.save({ validateModifiedOnly: true });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_TABLE_UPDATED",
      resource: "Table", entityType: "Table", entityId: table._id,
      storeId: str(req.params.storeId),
      description: `Table ${table.tableNumber} updated`,
      previousValue: before,
      newValue: {
        status: table.status, capacity: table.capacity,
        zone: table.zone, qrEnabled: table.qrEnabled,
      },
    });

    res.status(200).json({
      success: true,
      data: {
        id: table._id, tableNumber: table.tableNumber, capacity: table.capacity,
        status: table.status, zone: table.zone, qrEnabled: table.qrEnabled,
      },
    });
  } catch (err) {
    next(err);
  }
};

// --- Users (restaurant staff logins) ----------------------------------------

const ALLOWED_USER_ROLES = ["Owner", "Admin", "Manager", "Chef", "Waiter", "Cashier", "Staff"];

/**
 * The people who can sign into this restaurant's POS.
 *
 * Not to be confused with CSD staff (StaffManagement) — these are the
 * restaurant's own employees.
 */
const listUsers = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const users = await User.find({ restaurantId, isDeleted: { $ne: true } })
      .select("-password -sessions -mfa -resetPasswordToken -emailVerificationToken -refreshTokens")
      .limit(500)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        canEdit: req.csdStaff?.role === "admin",
        roles: ALLOWED_USER_ROLES,
        users: users.map((u) => ({
          id: u._id,
          name: u.name || "",
          phone: u.phone || "",
          email: u.email || "",
          role: u.role || "Staff",
          isActive: u.isActive !== false,
          lastLoginAt: u.lastLoginAt || null,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { restaurantId } = await restaurantForStore(req.params.storeId);
    const user = await User.findOne({
      _id: asObjectId(req.params.userId, "user id"),
      restaurantId,
      isDeleted: { $ne: true },
    });
    if (!user) return next(createHttpError(404, "User not found for this store."));

    const body = req.body || {};
    const before = { name: user.name, phone: user.phone, email: user.email, role: user.role, isActive: user.isActive };

    if (typeof body.name === "string") user.name = body.name.trim().slice(0, 200);
    if (typeof body.phone === "string") user.phone = body.phone.replace(/\D/g, "").slice(0, 20);
    if (typeof body.email === "string") user.email = body.email.trim().toLowerCase().slice(0, 200);

    if (typeof body.role === "string") {
      if (!ALLOWED_USER_ROLES.includes(body.role)) {
        return next(createHttpError(400, `Role must be one of: ${ALLOWED_USER_ROLES.join(", ")}.`));
      }
      user.role = body.role;
    }
    if (typeof body.isActive === "boolean") user.isActive = body.isActive;

    // Passwords are never set or reset from here. A support tool that can
    // choose someone's password can impersonate them; the POS owns that flow.
    await user.save({ validateModifiedOnly: true });

    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_RESTAURANT_USER_UPDATED",
      resource: "User", entityType: "User", entityId: user._id,
      storeId: str(req.params.storeId),
      description: `Restaurant user "${before.name || user._id}" updated`,
      previousValue: before,
      newValue: { name: user.name, phone: user.phone, email: user.email, role: user.role, isActive: user.isActive },
    });

    res.status(200).json({
      success: true,
      data: {
        id: user._id, name: user.name, phone: user.phone,
        email: user.email, role: user.role, isActive: user.isActive,
      },
    });
  } catch (err) {
    next(err);
  }
};

// --- Landing page ------------------------------------------------------------

/**
 * The customer website's front door.
 *
 * Manage Website belongs to KnotKitchen support, not to the restaurant -- the
 * POS route refuses `landing` for the same reason it refuses `branding` and
 * `theme`. This is the editor that side of the boundary, so it is the only
 * place the landing page can be changed.
 *
 * Reads are open to any signed-in CSD staff member; the write is admin-only,
 * matching every other write in this file.
 */

/**
 * Background images are pasted in as URLs rather than picked from a media
 * library: CSD has no media browser, and the store's own library is scoped to
 * a POS session this request does not have. The scheme check is the point --
 * the value lands in a CSS `url()` and an <img src>, so `javascript:` and
 * `data:` must not survive.
 */
const safeImageUrl = (value) => {
  const url = str(value).slice(0, 500);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    throw createHttpError(400, "Background image must be a full http:// or https:// URL.");
  }
  return url;
};

const landingResponse = (settings) => ({
  templates: LANDING_TEMPLATES,
  canEdit: false,
  storefrontUrl: buildStorefrontUrl(settings),
  landing: {
    template: settings.landing?.template || "hero-classic",
    headline: settings.landing?.headline || "",
    subheadline: settings.landing?.subheadline || "",
    ctaText: settings.landing?.ctaText || "View Menu",
    backgroundImageUrl: settings.landing?.backgroundImage?.url || "",
    overlayOpacity: settings.landing?.overlayOpacity ?? 45,
    showHours: settings.landing?.showHours !== false,
    showContact: settings.landing?.showContact !== false,
    showOffers: settings.landing?.showOffers !== false,
  },
  // What the page falls back to when a field above is left blank, so the
  // editor can show it as placeholder text instead of looking empty.
  fallbacks: {
    headline: settings.branding?.siteTitle || settings.displayName || "",
    subheadline: settings.branding?.tagline || "",
    backgroundImageUrl: settings.branding?.coverImage?.url || "",
  },
});

/** Load this store's website settings, or explain why there are none. */
const websiteForStore = async (storeId) => {
  const id = str(storeId);
  if (!/^\d{6}$/.test(id)) throw createHttpError(400, "Store ID must be 6 digits.");

  const settings = await WebsiteSettings.findOne({ storeId: id, isDeleted: { $ne: true } });
  if (!settings) {
    throw createHttpError(404, "This store has no customer website yet.");
  }
  return settings;
};

const getLanding = async (req, res, next) => {
  try {
    const settings = await websiteForStore(req.params.storeId);
    res.status(200).json({
      success: true,
      data: { ...landingResponse(settings), canEdit: req.csdStaff?.role === "admin" },
    });
  } catch (err) {
    next(err);
  }
};

const updateLanding = async (req, res, next) => {
  try {
    const settings = await websiteForStore(req.params.storeId);
    const body = req.body || {};
    const before = landingResponse(settings).landing;

    if (!settings.landing) settings.landing = {};

    if (body.template !== undefined) {
      if (!LANDING_TEMPLATES.includes(str(body.template))) {
        throw createHttpError(400, `Template must be one of: ${LANDING_TEMPLATES.join(", ")}.`);
      }
      settings.landing.template = str(body.template);
    }
    if (body.headline !== undefined) settings.landing.headline = str(body.headline).slice(0, 120);
    if (body.subheadline !== undefined) settings.landing.subheadline = str(body.subheadline).slice(0, 300);
    if (body.ctaText !== undefined) settings.landing.ctaText = str(body.ctaText).slice(0, 40) || "View Menu";

    if (body.backgroundImageUrl !== undefined) {
      const url = safeImageUrl(body.backgroundImageUrl);
      settings.landing.backgroundImage = url ? { mediaId: null, url, thumbnailUrl: url, alt: "" } : {};
    }

    if (body.overlayOpacity !== undefined) {
      const pct = Number(body.overlayOpacity);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        throw createHttpError(400, "Overlay must be between 0 and 100.");
      }
      settings.landing.overlayOpacity = Math.round(pct);
    }

    for (const key of ["showHours", "showContact", "showOffers"]) {
      if (typeof body[key] === "boolean") settings.landing[key] = body[key];
    }

    await settings.save({ validateModifiedOnly: true });

    const after = landingResponse(settings).landing;
    await csdAudit({
      req, staff: req.csdStaff,
      action: "CSD_WEBSITE_LANDING_UPDATED",
      resource: "WebsiteSettings", entityType: "WebsiteSettings", entityId: settings._id,
      storeId: str(req.params.storeId),
      description: `Landing page updated (${after.template})`,
      previousValue: before,
      newValue: after,
    });

    res.status(200).json({
      success: true,
      data: { ...landingResponse(settings), canEdit: true },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listMenus, toggleMenuPublish, updateDish,
  listTables, updateTable,
  listUsers, updateUser,
  getLanding, updateLanding,
  ALLOWED_USER_ROLES, TABLE_STATUSES, LANDING_TEMPLATES,
};
