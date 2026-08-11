const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const createHttpError = require("http-errors");

// Overview: all registered restaurants with owner + key stats
const getAllRestaurants = async (req, res, next) => {
  try {
    const restaurants = await Restaurant.find({ isDeleted: { $ne: true } })
      .populate("ownerId", "name email phone role lastLoginAt isActive createdAt");

    const data = await Promise.all(
      restaurants.map(async (r) => {
        const [menuCount, orderCount, staffCount, tableCount, todayOrders] = await Promise.all([
          Menu.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Order.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          User.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Table.countDocuments({ restaurantId: r._id, isDeleted: { $ne: true } }),
          Order.countDocuments({ restaurantId: r._id, orderDate: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
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

    if (!restaurant) {
      const error = createHttpError(404, "Restaurant not found!");
      return next(error);
    }

    const [menus, orders, tables, staff] = await Promise.all([
      Menu.find({ restaurantId: id, isDeleted: { $ne: true } }),
      Order.find({ restaurantId: id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(50),
      Table.find({ restaurantId: id, isDeleted: { $ne: true } }),
      User.find({ restaurantId: id, isDeleted: { $ne: true } }).select("-password -sessions"),
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
    if (!restaurant) {
      const error = createHttpError(404, "Restaurant not found!");
      return next(error);
    }

    restaurant.isActive = !restaurant.isActive;
    await restaurant.save();

    // Also toggle the owner account
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
    const updates = req.body;

    const allowedFields = ["name", "legalName", "registrationNumber", "taxId", "currency", "timezone", "address", "branding", "subscription"];
    const filtered = {};
    allowedFields.forEach((f) => {
      if (updates[f] !== undefined) filtered[f] = updates[f];
    });

    const restaurant = await Restaurant.findByIdAndUpdate(id, filtered, { new: true, runValidators: true });
    if (!restaurant) {
      const error = createHttpError(404, "Restaurant not found!");
      return next(error);
    }

    res.status(200).json({ success: true, message: "Restaurant updated!", data: restaurant });
  } catch (error) {
    next(error);
  }
};

module.exports = { getAllRestaurants, getRestaurantDetail, toggleRestaurantStatus, updateRestaurant };