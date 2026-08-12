const createHttpError = require("http-errors");
const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");
const Menu = require("../models/menuModel");

const getPublicStoreInfo = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
      const error = createHttpError(400, "Invalid 6-digit Store ID format.");
      return next(error);
    }

    const store = await Store.findOne({
      storeId: String(storeId).trim(),
      isDeleted: { $ne: true },
    });

    if (!store) {
      const error = createHttpError(404, "Store not found.");
      return next(error);
    }

    let restaurant = null;
    if (store.restaurantId) {
      restaurant = await Restaurant.findById(store.restaurantId);
    }

    res.status(200).json({
      success: true,
      data: {
        storeId: store.storeId,
        storeName: store.storeName,
        ownerName: store.ownerName,
        status: store.status,
        currency: restaurant?.currency || "GBP",
        address: restaurant?.address || {},
        branding: restaurant?.branding || {},
      },
    });
  } catch (error) {
    next(error);
  }
};

const getPublicStoreMenu = async (req, res, next) => {
  try {
    const { storeId } = req.params;
    if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
      const error = createHttpError(400, "Invalid 6-digit Store ID format.");
      return next(error);
    }

    const store = await Store.findOne({
      storeId: String(storeId).trim(),
      isDeleted: { $ne: true },
    });

    if (!store) {
      const error = createHttpError(404, "Store not found.");
      return next(error);
    }

    if (!store.restaurantId) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    // Strict multi-tenant query: ONLY menus belonging to this restaurantId
    const menus = await Menu.find({
      restaurantId: store.restaurantId,
      isDeleted: { $ne: true },
      published: true,
    });

    res.status(200).json({
      success: true,
      data: menus,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPublicStoreInfo,
  getPublicStoreMenu,
};
