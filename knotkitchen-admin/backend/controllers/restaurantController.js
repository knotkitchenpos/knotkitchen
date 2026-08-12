const Restaurant = require("../models/restaurantModel");
const User = require("../models/userModel");
const Menu = require("../models/menuModel");
const Order = require("../models/orderModel");
const Table = require("../models/tableModel");
const Store = require("../models/storeModel");
const createHttpError = require("http-errors");

const generateUniqueStoreId = async () => {
  let attempts = 0;
  while (attempts < 100) {
    const storeId = Math.floor(100000 + Math.random() * 900000).toString();
    const existing = await Store.findOne({ storeId });
    if (!existing) return storeId;
    attempts++;
  }
  throw new Error("Failed to generate unique Store ID");
};

// Admin: Create Store (Onboard Restaurant after agreement)
const createStore = async (req, res, next) => {
  try {
    const { storeName, ownerName, ownerPhone } = req.body;

    if (!storeName || !ownerName || !ownerPhone) {
      const error = createHttpError(400, "Store Name, Owner Name, and Owner Phone Number are required!");
      return next(error);
    }

    const cleanPhone = String(ownerPhone).trim();
    if (!/^\d{10}$/.test(cleanPhone)) {
      const error = createHttpError(400, "Owner phone number must be exactly 10 digits!");
      return next(error);
    }

    const cleanStoreName = String(storeName).trim();
    const cleanOwnerName = String(ownerName).trim();

    // Check if store already exists by store name
    const existingStore = await Store.findOne({ storeName: cleanStoreName, isDeleted: { $ne: true } });
    if (existingStore) {
      const error = createHttpError(400, "A store with this name already exists!");
      return next(error);
    }

    // Check if owner phone is already associated with another store
    const existingPhone = await Store.findOne({ ownerPhone: cleanPhone, isDeleted: { $ne: true } });
    if (existingPhone) {
      const error = createHttpError(400, "This owner phone number is already associated with another store!");
      return next(error);
    }

    // Generate unique 6-digit Store ID automatically
    const storeId = await generateUniqueStoreId();

    const newStore = await Store.create({
      storeId,
      storeName: cleanStoreName,
      ownerName: cleanOwnerName,
      ownerPhone: cleanPhone,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Store created successfully!",
      data: {
        storeId: newStore.storeId,
        storeName: newStore.storeName,
        ownerName: newStore.ownerName,
        ownerPhone: newStore.ownerPhone,
        status: newStore.status,
        createdAt: newStore.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Admin: Get all stores
const getAllStores = async (req, res, next) => {
  try {
    const stores = await Store.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: stores });
  } catch (error) {
    next(error);
  }
};

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

module.exports = {
  createStore,
  getAllStores,
  getAllRestaurants,
  getRestaurantDetail,
  toggleRestaurantStatus,
  updateRestaurant,
};
