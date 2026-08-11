const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const Admin = require("../models/adminModel");

const isAdminVerified = async (req, res, next) => {
  try {
    const token = req.cookies?.adminToken || req.headers?.authorization?.replace("Bearer ", "");
    if (!token) {
      const error = createHttpError(401, "Please provide admin token!");
      return next(error);
    }

    const decoded = jwt.verify(token, config.adminSecret);
    const admin = await Admin.findById(decoded._id);
    if (!admin || !admin.isActive) {
      const error = createHttpError(401, "Admin not found or deactivated!");
      return next(error);
    }

    req.admin = admin;
    next();
  } catch (error) {
    const err = createHttpError(401, "Invalid token!");
    next(err);
  }
};

module.exports = { isAdminVerified };