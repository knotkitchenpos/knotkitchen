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

// Seed the default super admin on first run if none exists
const seedSuperAdmin = async () => {
  try {
    const count = await Admin.countDocuments();
    if (count === 0) {
      await Admin.create({
        name: "Super Admin",
        email: config.seedAdminEmail,
        password: config.seedAdminPassword,
        role: "superadmin",
      });
      console.log(`✅ Seeded default super admin: ${config.seedAdminEmail}`);
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

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      const error = createHttpError(401, "Invalid credentials!");
      return next(error);
    }

    if (!admin.isActive) {
      const error = createHttpError(403, "Admin account is deactivated!");
      return next(error);
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      const error = createHttpError(401, "Invalid credentials!");
      return next(error);
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const token = generateAdminToken(admin);
    res.cookie("adminToken", token, {
      maxAge: 1000 * 60 * 60 * 2, // 2h
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
    });

    res.status(200).json({ success: true, message: "Admin login successful!", data: admin.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    res.clearCookie("adminToken");
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