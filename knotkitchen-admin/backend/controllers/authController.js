const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const createHttpError = require("http-errors");
const config = require("../config/config");
const Admin = require("../models/adminModel");

const generateAdminToken = (admin) => {
  return jwt.sign({ _id: admin._id, role: admin.role, email: admin.email }, config.adminSecret, {
    expiresIn: config.adminTokenExpiry,
  });
};

// Seed the default super admin on first run or reset if requested
const seedSuperAdmin = async () => {
  try {
    const email = (config.seedAdminEmail || "admin@knotkitchen.io").trim().toLowerCase();
    const rawPassword = (config.seedAdminPassword || "admin123").trim();

    const existingAdmin = await Admin.findOne({ email });

    if (!existingAdmin) {
      await Admin.create({
        name: "Super Admin",
        email: email,
        password: rawPassword,
        role: "superadmin",
        isActive: true,
      });
      console.log(`✅ Seeded default super admin: ${email}`);
    } else if (process.env.RESET_ADMIN_PASSWORD === "true") {
      existingAdmin.password = rawPassword;
      existingAdmin.isActive = true;
      await existingAdmin.save();
      console.log(`🔄 Reset password for super admin: ${email}`);
    } else if (!existingAdmin.isActive) {
      existingAdmin.isActive = true;
      await existingAdmin.save();
    }
  } catch (error) {
    console.error("❌ Error seeding super admin:", error.message);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      const error = createHttpError(400, "Email and password are required!");
      return next(error);
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    const admin = await Admin.findOne({ email: cleanEmail });
    if (!admin) {
      const error = createHttpError(401, "Invalid credentials!");
      return next(error);
    }

    if (!admin.isActive) {
      const error = createHttpError(403, "Admin account is deactivated!");
      return next(error);
    }

    const isMatch = await bcrypt.compare(cleanPassword, admin.password);
    if (!isMatch) {
      const error = createHttpError(401, "Invalid credentials!");
      return next(error);
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const token = generateAdminToken(admin);
    const isProduction = config.nodeEnv === "production";
    const sameSiteMode = isProduction ? (process.env.SAME_SITE_COOKIE || "none") : "lax";

    res.cookie("adminToken", token, {
      maxAge: 1000 * 60 * 60 * 2, // 2h
      httpOnly: true,
      sameSite: sameSiteMode,
      secure: isProduction,
    });

    res.status(200).json({ success: true, message: "Admin login successful!", data: admin.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const isProduction = config.nodeEnv === "production";
    const sameSiteMode = isProduction ? (process.env.SAME_SITE_COOKIE || "none") : "lax";

    res.clearCookie("adminToken", {
      httpOnly: true,
      sameSite: sameSiteMode,
      secure: isProduction,
    });
    res.status(200).json({ success: true, message: "Admin logged out!" });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: req.admin.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

module.exports = { login, logout, getMe, seedSuperAdmin };