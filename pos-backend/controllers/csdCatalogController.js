const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const Menu = require("../models/menuModel");
const User = require("../models/userModel");
const Store = require("../models/storeModel");
const { csdAudit } = require("../services/csdAuditService");

/**
 * Menus (read-only) and Users for the CSD panel, ported from the retired
 * Admin Portal.
 *
 * Two deliberate differences from the Admin Portal version:
 *
 *   1. Everything is addressed by the 6-digit storeId, not a Mongo ObjectId.
 *      That is the identifier CSD staff actually have in front of them — it is
 *      what the restaurant quotes on the phone — and it keeps every write
 *      scoped to one restaurant instead of operating on a global id.
 *
 *   2. Every write is audited. The Admin Portal changed prices and roles with
 *      no record of who did it; a support tool that can change a login needs
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

module.exports = {
  listMenus,
  listUsers, updateUser,
  ALLOWED_USER_ROLES,
};
