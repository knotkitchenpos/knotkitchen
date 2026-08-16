const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const createHttpError = require("http-errors");
const config = require("../config/config");
const Admin = require("../models/adminModel");

const generateAdminToken = (admin) =>
  jwt.sign(
    { _id: admin._id, role: admin.role, email: admin.email },
    config.adminSecret,
    { expiresIn: config.adminTokenExpiry, algorithm: "HS256" }
  );

/**
 * Seed the default super admin on first run.
 *
 * SECURITY: The previous behaviour would silently seed
 *   email = "admin@knotkitchen.io"
 *   password = "admin123"
 * on every fresh deployment. That is a well-known default; anyone who knew
 * the URL could take over the entire platform. Now:
 *   - Production requires ADMIN_PASSWORD >= 12 chars and NOT a common
 *     default (see config.js). Boot fails otherwise.
 *   - Dev retains the "admin123" convenience default, but the loud warning
 *     printed by config.js makes it obvious to change.
 *   - RESET_ADMIN_PASSWORD is respected only when explicitly set to "true"
 *     AND we log a clear warning so operators notice the credential rotation.
 */
const seedSuperAdmin = async () => {
  try {
    const email = config.seedAdminEmail;
    const rawPassword = config.seedAdminPassword;

    const existingAdmin = await Admin.findOne({ email });

    if (!existingAdmin) {
      await Admin.create({
        name: "Super Admin",
        email,
        password: rawPassword,
        role: "superadmin",
        isActive: true,
      });
      console.log(`✅ Seeded default super admin: ${email}`);
      if (!config.isProduction) {
        console.warn(
          "[SECURITY] A default admin was created for local development. Change the ADMIN_PASSWORD env before deploying."
        );
      }
    } else if (process.env.RESET_ADMIN_PASSWORD === "true") {
      console.warn(`[SECURITY] RESET_ADMIN_PASSWORD=true — resetting password for ${email}.`);
      existingAdmin.password = rawPassword;
      existingAdmin.isActive = true;
      await existingAdmin.save();
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
    const rawEmail = req.body?.email;
    const rawPassword = req.body?.password;
    if (typeof rawEmail !== "string" || typeof rawPassword !== "string") {
      return next(createHttpError(400, "Email and password are required!"));
    }

    const email = rawEmail.trim().toLowerCase();
    const password = rawPassword.trim();
    if (!email || !password) return next(createHttpError(400, "Email and password are required!"));

    const admin = await Admin.findOne({ email });
    // Generic error — do not reveal whether the account exists (§21).
    if (!admin) return next(createHttpError(401, "Invalid credentials!"));
    if (!admin.isActive) return next(createHttpError(401, "Invalid credentials!"));

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return next(createHttpError(401, "Invalid credentials!"));

    admin.lastLoginAt = new Date();
    await admin.save();

    const token = generateAdminToken(admin);
    const isProduction = config.isProduction;
    // If Secure is off (local http://), SameSite=none is invalid — downgrade to Lax.
    const sameSiteMode = isProduction
      ? (process.env.SAME_SITE_COOKIE || "none")
      : "lax";

    res.cookie("adminToken", token, {
      maxAge: 1000 * 60 * 60 * 2, // 2h
      httpOnly: true,
      sameSite: sameSiteMode === "none" && !isProduction ? "lax" : sameSiteMode,
      secure: isProduction,
      path: "/",
    });

    res.status(200).json({ success: true, message: "Admin login successful!", data: admin.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    const isProduction = config.isProduction;
    const sameSiteMode = isProduction ? (process.env.SAME_SITE_COOKIE || "none") : "lax";

    res.clearCookie("adminToken", {
      httpOnly: true,
      sameSite: sameSiteMode === "none" && !isProduction ? "lax" : sameSiteMode,
      secure: isProduction,
      path: "/",
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
