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

module.exports = {
  onboardRestaurant,
  getMyRestaurant,
  updateRestaurant,
  addOutlet,
  getOutlets,
  updateOutlet,
  deleteOutlet,
  getFranchiseOverview,
};