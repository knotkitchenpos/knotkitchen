const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const createHttpError = require("http-errors");
const mongoose = require("mongoose");

// ====== Users (Staff) ======
const getAllUsers = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    const users = await User.find(query).select("-password -sessions");
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, isActive, name, phone, email, permissions, restaurantId, outletId } = req.body;

    const user = await User.findById(id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (email !== undefined) user.email = email;
    if (permissions !== undefined) user.permissions = permissions;
    if (restaurantId !== undefined) user.restaurantId = restaurantId;
    if (outletId !== undefined) user.outletId = outletId;

    await user.save();
    res.status(200).json({ success: true, message: "User updated!", data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

// ====== Menus ======
const getAllMenus = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    const menus = await Menu.find(query);
    res.status(200).json({ success: true, data: menus });
  } catch (error) {
    next(error);
  }
};

const updateDish = async (req, res, next) => {
  try {
    const { menuId, itemId } = req.params;
    const updates = req.body;

    const menu = await Menu.findById(menuId);
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

    const item = menu.items.id(itemId);
    if (!item) {
      const error = createHttpError(404, "Dish not found!");
      return next(error);
    }

    const allowed = ["name", "price", "category", "isAvailable", "description", "image", "isVegetarian", "allergens"];
    allowed.forEach((f) => {
      if (updates[f] !== undefined) item[f] = updates[f];
    });

    await menu.save();
    res.status(200).json({ success: true, message: "Dish updated!", data: menu });
  } catch (error) {
    next(error);
  }
};

const toggleMenuPublish = async (req, res, next) => {
  try {
    const { id } = req.params;
    const menu = await Menu.findById(id);
    if (!menu) {
      const error = createHttpError(404, "Menu not found!");
      return next(error);
    }

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
    const { restaurantId, status } = req.query;
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    if (status) query.orderStatus = status;

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit) || 100)
      .populate("table", "tableNumber capacity status");
    res.status(200).json({ success: true, data: orders });
  } catch (error) {
    next(error);
  }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { orderStatus } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      const error = createHttpError(404, "Order not found!");
      return next(error);
    }

    if (orderStatus !== undefined) {
      order.orderStatus = orderStatus;
      order.timeline = order.timeline || [];
      order.timeline.push({ status: orderStatus, timestamp: new Date(), user: req.admin?.name || "Admin" });
    }

    await order.save();
    res.status(200).json({ success: true, message: "Order updated!", data: order });
  } catch (error) {
    next(error);
  }
};

// ====== Tables ======
const getAllTables = async (req, res, next) => {
  try {
    const { restaurantId } = req.query;
    const query = { isDeleted: { $ne: true } };
    if (restaurantId) query.restaurantId = restaurantId;
    const tables = await Table.find(query).populate("currentOrderId", "customerDetails bills totalWithTax orderStatus");
    res.status(200).json({ success: true, data: tables });
  } catch (error) {
    next(error);
  }
};

const updateTable = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, capacity, zone, qrEnabled, tableNumber, currentOrderId } = req.body;

    const table = await Table.findById(id);
    if (!table) {
      const error = createHttpError(404, "Table not found!");
      return next(error);
    }

    if (status !== undefined) table.status = status;
    if (capacity !== undefined) table.capacity = capacity;
    if (zone !== undefined) table.zone = zone;
    if (qrEnabled !== undefined) table.qrEnabled = qrEnabled;
    if (tableNumber !== undefined) table.tableNumber = tableNumber;
    if (currentOrderId !== undefined) table.currentOrderId = currentOrderId;

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

    const [restaurantCount, userCount, orderCount30, revenue30, tableCount, menuCount] = await Promise.all([
      mongoose.models.Restaurant.countDocuments({ isDeleted: { $ne: true } }),
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