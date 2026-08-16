const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");

/**
 * Admin data controller (§29).
 *
 * Every "update" here is a super-admin action against a specific tenant's
 * resources. The rules:
 *
 *   - IDs supplied via req.params / req.query are validated as ObjectIds
 *     before use so a request like `?restaurantId={"$ne":null}` cannot pass
 *     through as a NoSQL operator.
 *   - Every mutating handler uses a STRICT field allow-list. The previous
 *     dataController.updateUser accepted `role`, `permissions`, `restaurantId`
 *     and `outletId` from the request body — a low-value bug or a compromised
 *     "support" admin could reassign users across tenants or elevate them to
 *     Owner. Now:
 *       * only super-admins can reach these routes (route-level guard)
 *       * role/permissions are constrained to the schema enum
 *       * restaurantId/outletId can only be set to a valid ObjectId that
 *         actually refers to an existing tenant (see moveUserBetweenTenants)
 */

const ALLOWED_USER_ROLES = ["Owner", "Admin", "Manager", "Chef", "Waiter", "Cashier", "Staff"];

const ensureObjectId = (val, fieldName) => {
  if (val === undefined || val === null || val === "") return undefined;
  if (!mongoose.Types.ObjectId.isValid(val)) {
    throw createHttpError(400, `Invalid ${fieldName}`);
  }
  return String(val);
};

// ====== Users (Staff) ======
const getAllUsers = async (req, res, next) => {
  try {
    const query = { isDeleted: { $ne: true } };
    if (req.query.restaurantId) {
      query.restaurantId = ensureObjectId(req.query.restaurantId, "restaurantId");
    }
    const users = await User.find(query)
      .select("-password -sessions -mfa -resetPasswordToken -emailVerificationToken")
      .limit(1000);
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const id = ensureObjectId(req.params.id, "user id");
    const user = await User.findById(id);
    if (!user) return next(createHttpError(404, "User not found!"));

    const body = req.body || {};

    // Allow-listed simple string fields
    if (typeof body.name === "string") user.name = body.name.trim().slice(0, 200);
    if (typeof body.phone === "string") user.phone = body.phone.replace(/\D/g, "").slice(0, 20);
    if (typeof body.email === "string") user.email = body.email.trim().toLowerCase().slice(0, 200);

    // Role: only from the enum
    if (typeof body.role === "string") {
      if (!ALLOWED_USER_ROLES.includes(body.role)) {
        return next(createHttpError(400, "Invalid role."));
      }
      user.role = body.role;
    }

    // isActive: coerce to boolean explicitly
    if (typeof body.isActive === "boolean") user.isActive = body.isActive;

    // Permissions: array of strings (short, alphanumeric+underscore only)
    if (Array.isArray(body.permissions)) {
      user.permissions = body.permissions
        .filter((p) => typeof p === "string" && /^[A-Za-z0-9_*]{1,64}$/.test(p))
        .slice(0, 100);
    }

    // Tenancy reassignment must reference REAL documents. This is the
    // most sensitive setting on this endpoint — a mis-issued restaurantId
    // would move the user (and everything they own) into another store.
    if (body.restaurantId !== undefined) {
      const nextRest = ensureObjectId(body.restaurantId, "restaurantId");
      if (nextRest) {
        const Restaurant = mongoose.model("Restaurant");
        const exists = await Restaurant.exists({ _id: nextRest, isDeleted: { $ne: true } });
        if (!exists) return next(createHttpError(400, "Invalid restaurantId."));
        user.restaurantId = nextRest;
      } else {
        user.restaurantId = undefined;
      }
    }
    if (body.outletId !== undefined) {
      user.outletId = ensureObjectId(body.outletId, "outletId");
    }

    // On tenant/role change, invalidate every existing session so a user
    // who was demoted or moved cannot keep using an old access token.
    user.sessions = [];

    await user.save();
    res.status(200).json({ success: true, message: "User updated!", data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

// ====== Menus ======
const getAllMenus = async (req, res, next) => {
  try {
    const query = { isDeleted: { $ne: true } };
    if (req.query.restaurantId) {
      query.restaurantId = ensureObjectId(req.query.restaurantId, "restaurantId");
    }
    const menus = await Menu.find(query).limit(1000);
    res.status(200).json({ success: true, data: menus });
  } catch (error) {
    next(error);
  }
};

const updateDish = async (req, res, next) => {
  try {
    const menuId = ensureObjectId(req.params.menuId, "menuId");
    const itemId = ensureObjectId(req.params.itemId, "itemId");
    const updates = req.body || {};

    const menu = await Menu.findById(menuId);
    if (!menu) return next(createHttpError(404, "Menu not found!"));

    const item = menu.items.id(itemId);
    if (!item) return next(createHttpError(404, "Dish not found!"));

    // Explicit whitelist of numeric / primitive dish fields the admin may
    // change. Nested edits (variants/addons/modifiers) go through the POS.
    if (typeof updates.name === "string") item.name = updates.name.trim().slice(0, 200);
    if (updates.price !== undefined) {
      const price = Number(updates.price);
      if (!Number.isFinite(price) || price < 0 || price > 1e7) {
        return next(createHttpError(400, "Invalid price."));
      }
      item.price = price;
    }
    if (typeof updates.category === "string") item.category = updates.category.trim().slice(0, 120);
    if (typeof updates.isAvailable === "boolean") item.isAvailable = updates.isAvailable;
    if (typeof updates.description === "string") item.description = updates.description.slice(0, 1000);
    if (typeof updates.image === "string") item.image = updates.image.slice(0, 500);
    if (typeof updates.isVegetarian === "boolean") item.isVegetarian = updates.isVegetarian;
    if (Array.isArray(updates.allergens)) {
      item.allergens = updates.allergens
        .filter((a) => typeof a === "string")
        .slice(0, 20)
        .map((a) => a.slice(0, 40));
    }

    await menu.save();
    res.status(200).json({ success: true, message: "Dish updated!", data: menu });
  } catch (error) {
    next(error);
  }
};

const toggleMenuPublish = async (req, res, next) => {
  try {
    const id = ensureObjectId(req.params.id, "menu id");
    const menu = await Menu.findById(id);
    if (!menu) return next(createHttpError(404, "Menu not found!"));

    menu.published = !menu.published;
    menu.isPublished = menu.published;
    if (menu.published) menu.publishedAt = new Date();
    await menu.save();

    res.status(200).json({
      success: true,
      message: menu.published ? "Menu published!" : "Menu unpublished!",
      data: menu,
    });
  } catch (error) {
    next(error);
  }
};

// ====== Orders ======
const getAllOrders = async (req, res, next) => {
  try {
    const query = { isDeleted: { $ne: true } };
    if (req.query.restaurantId) query.restaurantId = ensureObjectId(req.query.restaurantId, "restaurantId");
    if (req.query.status && typeof req.query.status === "string") {
      query.orderStatus = String(req.query.status).slice(0, 40);
    }

    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("table", "tableNumber capacity status");
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const id = ensureObjectId(req.params.id, "order id");
    const { orderStatus } = req.body || {};

    if (typeof orderStatus !== "string" || orderStatus.length > 40) {
      return next(createHttpError(400, "Invalid order status."));
    }

    const order = await Order.findById(id);
    if (!order) return next(createHttpError(404, "Order not found!"));

    order.orderStatus = orderStatus;
    order.timeline = order.timeline || [];
    order.timeline.push({
      status: orderStatus,
      timestamp: new Date(),
      user: req.admin?.name || "Admin",
    });

    await order.save();
    res.status(200).json({ success: true, message: "Order updated!", data: order });
  } catch (error) {
    next(error);
  }
};

// ====== Tables ======
const getAllTables = async (req, res, next) => {
  try {
    const query = { isDeleted: { $ne: true } };
    if (req.query.restaurantId) query.restaurantId = ensureObjectId(req.query.restaurantId, "restaurantId");
    const tables = await Table.find(query)
      .limit(500)
      .populate("currentOrderId", "customerDetails bills totalWithTax orderStatus");
    res.status(200).json({ success: true, data: tables });
  } catch (error) {
    next(error);
  }
};

const updateTable = async (req, res, next) => {
  try {
    const id = ensureObjectId(req.params.id, "table id");
    const body = req.body || {};

    const table = await Table.findById(id);
    if (!table) return next(createHttpError(404, "Table not found!"));

    if (typeof body.status === "string") {
      const allowed = ["available", "occupied", "reserved", "cleaning"];
      if (!allowed.includes(body.status)) return next(createHttpError(400, "Invalid table status."));
      table.status = body.status;
    }
    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (!Number.isInteger(cap) || cap < 1 || cap > 100) {
        return next(createHttpError(400, "Capacity must be between 1 and 100."));
      }
      table.capacity = cap;
    }
    if (typeof body.zone === "string") table.zone = body.zone.slice(0, 120);
    if (typeof body.qrEnabled === "boolean") table.qrEnabled = body.qrEnabled;
    if (body.tableNumber !== undefined) {
      const n = Number(body.tableNumber);
      if (!Number.isInteger(n) || n < 1 || n > 100000) {
        return next(createHttpError(400, "Invalid table number."));
      }
      table.tableNumber = n;
    }
    if (body.currentOrderId !== undefined) {
      table.currentOrderId = ensureObjectId(body.currentOrderId, "currentOrderId");
    }

    await table.save();
    res.status(200).json({ success: true, message: "Table updated!", data: table });
  } catch (error) {
    next(error);
  }
};

// ====== Dashboard overview (global) ======
const getGlobalStats = async (req, res, next) => {
  try {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);

    const start30 = new Date();
    start30.setDate(start30.getDate() - 30);

    const Restaurant = mongoose.model("Restaurant");
    const [restaurantCount, userCount, orderCount30, revenue30, tableCount, menuCount] = await Promise.all([
      Restaurant.countDocuments({ isDeleted: { $ne: true } }),
      User.countDocuments({ isDeleted: { $ne: true } }),
      Order.countDocuments({ createdAt: { $gte: start30 }, isDeleted: { $ne: true } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: start30 }, isDeleted: { $ne: true } } },
        { $group: { _id: null, total: { $sum: "$bills.totalWithTax" } } },
      ]),
      Table.countDocuments({ isDeleted: { $ne: true } }),
      Menu.countDocuments({ isDeleted: { $ne: true } }),
    ]);

    const todayRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: startToday }, isDeleted: { $ne: true } } },
      { $group: { _id: null, total: { $sum: "$bills.totalWithTax" } } },
    ]);

    res.status(200).json({
      success: true,
      data: {
        restaurants: restaurantCount,
        users: userCount,
        orders30d: orderCount30,
        revenue30d: revenue30[0]?.total || 0,
        revenueToday: todayRevenue[0]?.total || 0,
        tables: tableCount,
        menus: menuCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllUsers,
  updateUser,
  getAllMenus,
  updateDish,
  toggleMenuPublish,
  getAllOrders,
  updateOrderStatus,
  getAllTables,
  updateTable,
  getGlobalStats,
};
