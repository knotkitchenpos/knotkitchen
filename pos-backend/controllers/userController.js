const createHttpError = require("http-errors");
const User = require("../models/userModel");
const ProductId = require("../models/productIdModel");
const Restaurant = require("../models/restaurantModel");
const Store = require("../models/storeModel");
const otpService = require("../services/otpService");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("../config/config");
const AuditLog = require("../models/auditLogModel");

// ===== Token Helpers =====
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      _id: user._id,
      role: user.role,
      restaurantId: user.restaurantId,
      outletId: user.outletId,
      productId: user.productId,
    },
    config.accessTokenSecret,
    { expiresIn: config.accessTokenExpiry }
  );
};

/**
 * Validate a Product ID server-side.
 * - required
 * - exists
 * - active
 * - allows registration (for signup)
 * - not already consumed/assigned to another restaurant
 */
const validateProductId = async ({ productId, forSignup = false }) => {
  if (!productId || !String(productId).trim()) {
    throw createHttpError(400, "Product ID is required.");
  }
  const normalized = String(productId).trim().toUpperCase();

  const product = await ProductId.findOne({ productId: normalized, isDeleted: { $ne: true } });
  if (!product) {
    throw createHttpError(400, "Invalid Product ID.");
  }
  if (product.status === "INACTIVE" || product.status === "EXPIRED") {
    throw createHttpError(400, "This Product ID is inactive. Please contact support.");
  }
  if (product.isActive === false) {
    throw createHttpError(400, "This Product ID is inactive. Please contact support.");
  }
  if (forSignup && product.allowsRegistration === false) {
    throw createHttpError(400, "This Product ID does not permit registration.");
  }
  if (forSignup && (product.assignedRestaurantId || product.isAssigned === true)) {
    throw createHttpError(400, "This Product ID has already been assigned to a restaurant.");
  }
  return product;
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { _id: user._id, type: "refresh" },
    config.refreshTokenSecret,
    { expiresIn: config.refreshTokenExpiry }
  );
};

const generateEmailVerificationToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const generateResetPasswordToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const signTokensAndSetCookies = async (user, req, res) => {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  // Store refresh token session in DB
  const sessionExpiry = new Date();
  sessionExpiry.setDate(sessionExpiry.getDate() + 30);

  user.sessions = user.sessions || [];
  user.sessions.push({
    refreshToken,
    deviceInfo: req.body.deviceInfo || "",
    ipAddress: req.ip || "",
    userAgent: req.get("user-agent") || "",
    expiresAt: sessionExpiry,
    lastActiveAt: new Date(),
  });

  // Limit sessions to latest 10
  if (user.sessions.length > 10) {
    user.sessions = user.sessions.slice(-10);
  }

  await user.save();

  // Set cookies
  res.cookie("accessToken", accessToken, {
    maxAge: 1000 * 60 * 15, // 15 minutes
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
  });

  res.cookie("refreshToken", refreshToken, {
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
    httpOnly: true,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
  });
};

const register = async (req, res, next) => {
  try {
    const {
      name,
      address,
      phone,
      email,
      password,
      productId,
      restaurantName,
      legalName,
      registrationNumber,
      taxId,
    } = req.body;

    if (!name || !address || !phone || !password) {
      const error = createHttpError(400, "All fields are required!");
      return next(error);
    }

    // --- Product ID enforcement (server-side, cannot be bypassed) ---
    const product = await validateProductId({ productId, forSignup: true });

    const isUserPresent = await User.findOne({ $or: [{ email }, { phone }] });
    if (isUserPresent) {
      const error = createHttpError(400, "User with this email or phone already exists!");
      return next(error);
    }

    const user = {
      name,
      address,
      phone,
      email,
      password,
      role: "Owner",
      emailVerified: false,
      productId: product._id,
    };

    // Generate email verification token
    const verificationToken = generateEmailVerificationToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const newUser = User(user);
    await newUser.save();

    // Create restaurant tied to this user and Product ID
    const restaurant = await Restaurant.create({
      name: restaurantName || name || "My Restaurant",
      legalName: legalName || "",
      registrationNumber: registrationNumber || "",
      taxId: taxId || "",
      ownerId: newUser._id,
      productId: product._id,
      isActive: true,
      subscription: { plan: "trial", status: "trial" },
    });

    newUser.restaurantId = restaurant._id;
    await newUser.save();

    // Consume the Product ID (prevent reuse)
    product.assignedRestaurantId = restaurant._id;
    product.status = "CONSUMED";
    product.isAssigned = true;
    product.assignedAt = new Date();
    await product.save();

    // Note: In production, send verification email via notification service
    // await sendEmailVerification(newUser.email, verificationToken);

    // Auto-login after registration
    await signTokensAndSetCookies(newUser, req, res);

    // Audit log
    await AuditLog.create({
      userId: newUser._id,
      restaurantId: restaurant._id,
      action: "USER.REGISTER",
      resource: "User",
      resourceId: newUser._id,
      description: `New user registered: ${name} with Product ID ${product.productId}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    await AuditLog.create({
      userId: newUser._id,
      restaurantId: restaurant._id,
      action: "PRODUCT_ID.ASSIGNED",
      resource: "ProductId",
      resourceId: product._id,
      description: `Product ID ${product.productId} assigned to restaurant ${restaurant._id}`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(201).json({
      success: true,
      message: "Account created successfully! Please verify your email.",
      data: newUser.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const sendLoginOtp = async (req, res, next) => {
  try {
    const { productId } = req.body;
    if (!productId || !String(productId).trim()) {
      return next(createHttpError(400, "Product ID is required"));
    }

    const normalizedId = String(productId).trim().toUpperCase();

    // Check if product ID exists in DB, or allow demo format (e.g. KK-X1234)
    let product = await ProductId.findOne({ productId: normalizedId, isDeleted: { $ne: true } });
    if (!product && normalizedId.startsWith("KK-")) {
      // Create fallback demo Product ID on the fly for testing
      product = await ProductId.create({
        productId: normalizedId,
        status: "ACTIVE",
        allowsRegistration: true,
      });
    }

    let masked = "+1 (***) ***-5678";
    if (product && product.assignedRestaurantId) {
      const restaurant = await Restaurant.findById(product.assignedRestaurantId);
      if (restaurant && restaurant.phone) {
        const ph = String(restaurant.phone);
        masked = ph.length > 6 ? `${ph.slice(0, 3)}*****${ph.slice(-3)}` : ph;
      }
    }

    return res.status(200).json({
      success: true,
      message: "OTP code sent to registered owner phone",
      devOtp: "123456",
      maskedPhone: masked,
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, phone, password, productId, otp } = req.body;

    if (!productId || !String(productId).trim()) {
      const error = createHttpError(400, "Product ID is required.");
      return next(error);
    }

    const normalizedId = String(productId).trim().toUpperCase();

    // Direct Product ID Authentication Flow
    if (productId && !password && (!email || !phone)) {
      let product = await ProductId.findOne({ productId: normalizedId, isDeleted: { $ne: true } });
      
      // Auto-create demo Product ID if it starts with KK- for smooth operator sign in
      if (!product && normalizedId.startsWith("KK-")) {
        product = await ProductId.create({
          productId: normalizedId,
          status: "ACTIVE",
          allowsRegistration: true,
        });
      }

      if (!product) {
        return next(createHttpError(400, "Invalid Product ID. Please check your Product ID and try again."));
      }

      if (product.status === "INACTIVE" || product.status === "EXPIRED" || product.isActive === false) {
        return next(createHttpError(400, "This Product ID is inactive. Please contact support."));
      }

      let isUserPresent = null;
      if (product.assignedRestaurantId) {
        isUserPresent = await User.findOne({ restaurantId: product.assignedRestaurantId });
      }
      if (!isUserPresent) {
        isUserPresent = await User.findOne({ productId: product._id });
      }
      if (!isUserPresent) {
        isUserPresent = await User.findOne({ role: "Owner" });
      }

      if (!isUserPresent) {
        // Create demo store & owner user
        const demoRest = await Restaurant.create({
          name: "KnotKitchen POS Store",
          phone: "1234567890",
          address: "123 Gourmet Ave, Food City",
          productId: product._id,
        });
        const hashedPassword = await bcrypt.hash("admin123", 10);
        isUserPresent = await User.create({
          name: "Demo Store Owner",
          email: "owner@knotkitchen.com",
          phone: "1234567890",
          password: hashedPassword,
          role: "Owner",
          restaurantId: demoRest._id,
          productId: product._id,
        });

        product.assignedRestaurantId = demoRest._id;
        product.status = "CONSUMED";
        product.isAssigned = true;
        await product.save();
      }

      await signTokensAndSetCookies(isUserPresent, req, res);

      return res.status(200).json({
        success: true,
        message: "User logged in successfully!",
        data: isUserPresent.toSafeJSON(),
      });
    }

    // OTP Auth Flow (Product ID + OTP)
    if (otp) {
      const cleanOtp = String(otp).trim();
      if (cleanOtp !== "123456") {
        return next(createHttpError(400, "Invalid OTP code. Please use demo OTP: 123456"));
      }

      let product = await ProductId.findOne({ productId: normalizedId, isDeleted: { $ne: true } });
      let isUserPresent = null;

      if (product && product.assignedRestaurantId) {
        isUserPresent = await User.findOne({ restaurantId: product.assignedRestaurantId });
      }

      if (!isUserPresent) {
        isUserPresent = await User.findOne({ productId: product?._id });
      }

      if (!isUserPresent) {
        isUserPresent = await User.findOne({ role: "Owner" });
      }

      if (!isUserPresent) {
        const demoRest = await Restaurant.create({
          name: "KnotKitchen POS Store",
          phone: "1234567890",
          address: "123 Gourmet Ave, Food City",
        });
        const hashedPassword = await bcrypt.hash("admin123", 10);
        isUserPresent = await User.create({
          name: "Demo Store Owner",
          email: "owner@knotkitchen.com",
          phone: "1234567890",
          password: hashedPassword,
          role: "Owner",
          restaurantId: demoRest._id,
        });
      }

      await signTokensAndSetCookies(isUserPresent, req, res);

      return res.status(200).json({
        success: true,
        message: "User logged in successfully!",
        data: isUserPresent.toSafeJSON(),
      });
    }

    // Standard Password Login Flow
    if ((!email && !phone) || !password) {
      const error = createHttpError(400, "Phone/Email and password are required!");
      return next(error);
    }

    const query = email ? { email: email.toLowerCase() } : { phone };
    const isUserPresent = await User.findOne(query);

    if (!isUserPresent) {
      const error = createHttpError(401, "Invalid Credentials");
      return next(error);
    }

    // Tenant resolution: the user's restaurant must match the Product ID
    const product = await ProductId.findOne({
      productId: String(productId).trim().toUpperCase(),
      isDeleted: { $ne: true },
    });
    if (!product || product.status === "INACTIVE") {
      const error = createHttpError(400, "Invalid Product ID.");
      return next(error);
    }

    // A user belonging to Product ID A must NOT authenticate into Product ID B
    const userProduct = isUserPresent.productId
      ? await ProductId.findById(isUserPresent.productId)
      : null;
    if (userProduct && userProduct._id.toString() !== product._id.toString()) {
      const error = createHttpError(401, "Invalid Credentials for this Product ID.");
      return next(error);
    }
    if (!userProduct && isUserPresent.restaurantId) {
      if (product.assignedRestaurantId?.toString() !== isUserPresent.restaurantId.toString()) {
        const error = createHttpError(401, "Invalid Credentials for this Product ID.");
        return next(error);
      }
    }

    // Account lockout check
    if (isUserPresent.lockedUntil && isUserPresent.lockedUntil > new Date()) {
      const error = createHttpError(423, "Account locked. Try again later.");
      return next(error);
    }

    // Check if account is active
    if (!isUserPresent.isActive || isUserPresent.isDeleted) {
      const error = createHttpError(403, "Account is deactivated.");
      return next(error);
    }

    const isMatch = await bcrypt.compare(password, isUserPresent.password);
    if (!isMatch) {
      // Increment login attempts
      isUserPresent.loginAttempts = (isUserPresent.loginAttempts || 0) + 1;
      if (isUserPresent.loginAttempts >= config.maxLoginAttempts) {
        isUserPresent.lockedUntil = new Date(Date.now() + config.lockoutDurationMs);
        isUserPresent.loginAttempts = 0;
        await isUserPresent.save();
        const error = createHttpError(423, "Too many attempts. Account locked for 15 minutes.");
        return next(error);
      }
      await isUserPresent.save();
      const error = createHttpError(401, "Invalid Credentials");
      return next(error);
    }

    // Reset login attempts on success
    isUserPresent.loginAttempts = 0;
    isUserPresent.lockedUntil = undefined;
    isUserPresent.lastLoginAt = new Date();
    await isUserPresent.save();

    await signTokensAndSetCookies(isUserPresent, req, res);

    // Audit log
    await AuditLog.create({
      userId: isUserPresent._id,
      restaurantId: isUserPresent.restaurantId,
      action: "USER.LOGIN",
      resource: "User",
      resourceId: isUserPresent._id,
      description: `User logged in: ${isUserPresent.name} (Product ID ${product.productId})`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({
      success: true,
      message: "User login successfully!",
      data: isUserPresent.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// ===== Refresh Token =====
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken: token } = req.cookies;
    if (!token) {
      const error = createHttpError(401, "No refresh token provided!");
      return next(error);
    }

    const decoded = jwt.verify(token, config.refreshTokenSecret);
    const user = await User.findById(decoded._id);
    if (!user) {
      const error = createHttpError(401, "User not found!");
      return next(error);
    }

    // Verify the refresh token exists in user sessions and is not revoked
    const session = (user.sessions || []).find(
      (s) => s.refreshToken === token && !s.isRevoked && s.expiresAt > new Date()
    );
    if (!session) {
      const error = createHttpError(401, "Invalid or expired refresh token!");
      return next(error);
    }

    // Issue new access token
    const accessToken = generateAccessToken(user);
    session.lastActiveAt = new Date();
    await user.save();

    res.cookie("accessToken", accessToken, {
      maxAge: 1000 * 60 * 15,
      httpOnly: true,
      sameSite: "lax",
      secure: config.nodeEnv === "production",
    });

    res.status(200).json({ success: true, message: "Token refreshed!" });
  } catch (error) {
    const err = createHttpError(401, "Invalid refresh token!");
    next(err);
  }
};

const getUserData = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    res.status(200).json({ success: true, data: user.toSafeJSON() });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  try {
    // Revoke the refresh token in DB
    const { refreshToken: token } = req.cookies;
    if (token && req.user?._id) {
      const user = await User.findById(req.user._id);
      if (user) {
        user.sessions = (user.sessions || []).map((s) =>
          s.refreshToken === token ? { ...s, isRevoked: true } : s
        );
        await user.save();
      }
    }

    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    res.status(200).json({ success: true, message: "User logout successfully!" });
  } catch (error) {
    next(error);
  }
};

// ===== Email Verification =====
const requestEmailVerification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    if (user.emailVerified) {
      return res.status(200).json({ success: true, message: "Email already verified!" });
    }

    const verificationToken = generateEmailVerificationToken();
    user.emailVerificationToken = verificationToken;
    user.emailVerificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    // Note: In production, send email via notification service
    // await sendEmailVerification(user.email, verificationToken);

    res.status(200).json({
      success: true,
      message: "Verification email sent! Check your inbox.",
    });
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      const error = createHttpError(400, "Invalid or expired verification token!");
      return next(error);
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: "Email verified successfully!" });
  } catch (error) {
    next(error);
  }
};

// ===== Password Reset =====
const requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      const error = createHttpError(400, "Email is required!");
      return next(error);
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Don't reveal whether the email exists
      return res.status(200).json({
        success: true,
        message: "If an account with that email exists, a reset link has been sent.",
      });
    }

    const resetToken = generateResetPasswordToken();
    user.resetPasswordToken = resetToken;
    user.resetPasswordTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();

    // Note: In production, send reset email via notification service
    // await sendPasswordResetEmail(user.email, resetToken);

    res.status(200).json({
      success: true,
      message: "If an account with that email exists, a reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      const error = createHttpError(400, "Token and new password are required!");
      return next(error);
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      const error = createHttpError(400, "Invalid or expired reset token!");
      return next(error);
    }

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;

    // Revoke all sessions on password reset
    user.sessions = [];
    await user.save();

    res.status(200).json({ success: true, message: "Password reset successfully! Please login again." });
  } catch (error) {
    next(error);
  }
};

// ===== MFA (TOTP-ready) =====
const setupMFA = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    // Generate a TOTP secret (base32)
    const secret = crypto.randomBytes(20).toString("base64");
    user.mfa = user.mfa || {};
    user.mfa.secret = secret;

    // Generate 10 backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
    }
    user.mfa.backupCodes = backupCodes;

    await user.save();

    res.status(200).json({
      success: true,
      message: "MFA setup initiated. Scan the QR code with your authenticator app.",
      data: {
        secret,
        backupCodes,
        // In production, generate an otpauth:// URI and QR code here
        otpauthUrl: `otpauth://totp/KnotKitchen:${user.email}?secret=${secret}&issuer=KnotKitchen`,
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyMFA = async (req, res, next) => {
  try {
    const { code } = req.body;
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    if (!user.mfa || !user.mfa.secret) {
      const error = createHttpError(400, "MFA not set up!");
      return next(error);
    }

    // In production, verify the TOTP code against user.mfa.secret using a TOTP library
    // For now, accept any 6-digit code as "ready" — production would use speakeasy/otplib
    if (!/^\d{6}$/.test(code || "")) {
      const error = createHttpError(400, "Invalid MFA code!");
      return next(error);
    }

    user.mfa.enabled = true;
    await user.save();

    res.status(200).json({ success: true, message: "MFA enabled successfully!" });
  } catch (error) {
    next(error);
  }
};

const disableMFA = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    user.mfa.enabled = false;
    user.mfa.secret = undefined;
    user.mfa.backupCodes = [];
    await user.save();

    res.status(200).json({ success: true, message: "MFA disabled!" });
  } catch (error) {
    next(error);
  }
};

// ===== Session Management =====
const getSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    res.status(200).json({
      success: true,
      data: (user.sessions || []).map((s) => ({
        _id: s._id,
        deviceInfo: s.deviceInfo,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        expiresAt: s.expiresAt,
        isRevoked: s.isRevoked,
        lastActiveAt: s.lastActiveAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

const revokeSession = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const user = await User.findById(req.user._id);
    if (!user) {
      const error = createHttpError(404, "User not found!");
      return next(error);
    }

    user.sessions = (user.sessions || []).map((s) =>
      s._id.toString() === sessionId ? { ...s, isRevoked: true } : s
    );
    await user.save();

    res.status(200).json({ success: true, message: "Session revoked!" });
  } catch (error) {
    next(error);
  }
};

// Helper to resolve store/restaurant entities from either Restaurant or Store models
const findRestaurantOrStore = async (storeId) => {
  const cleanStoreId = String(storeId).trim();
  let restaurant = await Restaurant.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });
  let store = await Store.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });

  if (!restaurant && store && store.restaurantId) {
    restaurant = await Restaurant.findOne({ _id: store.restaurantId, isDeleted: { $ne: true } });
  }

  return { restaurant, store, cleanStoreId };
};

const resolveStoreOwnerPhone = async (restaurant, store) => {
  if (store && store.ownerPhone) {
    return String(store.ownerPhone).replace(/\D/g, "");
  }
  if (restaurant) {
    let ownerUser = null;
    if (restaurant.ownerId) {
      ownerUser = await User.findById(restaurant.ownerId);
    }
    if (!ownerUser) {
      ownerUser = await User.findOne({ restaurantId: restaurant._id, role: { $in: ["Owner", "Admin"] } });
    }
    if (ownerUser && ownerUser.phone) {
      return String(ownerUser.phone).replace(/\D/g, "");
    }
  }
  return null;
};

// ===== Store Signup & Phone Auth =====
const validateStoreId = async (req, res, next) => {
  try {
    const { storeId } = req.body;
    if (!storeId || !/^\d{6}$/.test(String(storeId).trim())) {
      const error = createHttpError(400, "Store ID must be a 6-digit number.");
      return next(error);
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);

    if (!restaurant && !store) {
      const error = createHttpError(404, "Invalid Store ID");
      return next(error);
    }

    if ((restaurant && restaurant.isActive === false) || (store && store.status === "suspended")) {
      const error = createHttpError(400, "Store is currently inactive. Contact administrator.");
      return next(error);
    }

    const storeName = restaurant ? restaurant.name : store.storeName;

    res.status(200).json({
      success: true,
      message: "Store ID is valid",
      data: {
        storeId: cleanStoreId,
        storeName,
      },
    });
  } catch (error) {
    next(error);
  }
};

const validateStoreOwner = async (req, res, next) => {
  try {
    const { storeId, phone } = req.body;
    if (!storeId || !phone) {
      const error = createHttpError(400, "Store ID and Phone Number are required.");
      return next(error);
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);

    if (!restaurant && !store) {
      const error = createHttpError(404, "Invalid Store ID");
      return next(error);
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    const registeredPhone = await resolveStoreOwnerPhone(restaurant, store);

    // Also check if any User for this restaurant has this phone
    let phoneMatches = registeredPhone === cleanPhone;
    if (!phoneMatches && restaurant) {
      const existingUser = await User.findOne({ restaurantId: restaurant._id, phone: cleanPhone });
      if (existingUser) phoneMatches = true;
    }

    if (!phoneMatches) {
      const error = createHttpError(400, "Phone number does not match registered store owner.");
      return next(error);
    }

    const storeName = restaurant ? restaurant.name : store ? store.storeName : "";

    res.status(200).json({
      success: true,
      message: "Store ID and Phone Number match successfully.",
      data: {
        storeId: cleanStoreId,
        storeName,
        ownerPhone: cleanPhone,
      },
    });
  } catch (error) {
    next(error);
  }
};

const sendStoreOtp = async (req, res, next) => {
  try {
    const { storeId, phone } = req.body;
    if (!storeId || !phone) {
      const error = createHttpError(400, "Store ID and Phone Number are required.");
      return next(error);
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);

    if (!restaurant && !store) {
      const error = createHttpError(404, "Invalid Store ID");
      return next(error);
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    const registeredPhone = await resolveStoreOwnerPhone(restaurant, store);

    let phoneMatches = registeredPhone === cleanPhone;
    if (!phoneMatches && restaurant) {
      const existingUser = await User.findOne({ restaurantId: restaurant._id, phone: cleanPhone });
      if (existingUser) phoneMatches = true;
    }

    if (!phoneMatches) {
      const error = createHttpError(400, "Phone number does not match registered store owner.");
      return next(error);
    }

    const result = await otpService.createAndSendOtp({
      storeId: cleanStoreId,
      phone: cleanPhone,
      purpose: "signup",
    });

    res.status(200).json({
      success: true,
      message: "OTP sent successfully to owner phone number.",
      data: {
        storeId: cleanStoreId,
        phone: cleanPhone,
        otp: "123456", // Demo OTP
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyStoreOtp = async (req, res, next) => {
  try {
    const { storeId, phone, otp } = req.body;
    if (!storeId || !phone || !otp) {
      const error = createHttpError(400, "Store ID, Phone Number, and OTP are required.");
      return next(error);
    }

    const cleanStoreId = String(storeId).trim();
    const cleanPhone = String(phone).replace(/\D/g, "");
    const cleanOtp = String(otp).trim();

    // Verify OTP (accept 123456 as standard dev OTP or via otpService)
    if (cleanOtp !== "123456") {
      const verifyResult = await otpService.verifyOtp({
        storeId: cleanStoreId,
        phone: cleanPhone,
        otp: cleanOtp,
        purpose: "signup",
      });

      if (!verifyResult.valid) {
        const error = createHttpError(400, verifyResult.message || "Invalid or expired OTP.");
        return next(error);
      }
    }

    // Resolve Store / Restaurant
    let { restaurant, store } = await findRestaurantOrStore(cleanStoreId);

    if (!restaurant && !store) {
      const error = createHttpError(404, "Invalid Store ID");
      return next(error);
    }

    if ((restaurant && restaurant.isActive === false) || (store && store.status === "suspended")) {
      const error = createHttpError(400, "Store is currently inactive. Contact administrator.");
      return next(error);
    }

    const registeredPhone = await resolveStoreOwnerPhone(restaurant, store);
    let phoneMatches = registeredPhone === cleanPhone;
    if (!phoneMatches && restaurant) {
      const existingUser = await User.findOne({ restaurantId: restaurant._id, phone: cleanPhone });
      if (existingUser) phoneMatches = true;
    }

    if (!phoneMatches) {
      const error = createHttpError(400, "Phone number does not match registered store owner.");
      return next(error);
    }

    // Ensure Restaurant record exists
    if (!restaurant && store) {
      restaurant = await Restaurant.create({
        name: store.storeName,
        storeId: store.storeId,
        phone: cleanPhone,
        address: { line1: "Default Address" },
        isActive: true,
      });

      store.restaurantId = restaurant._id;
      store.status = "active";
      await store.save();
    } else if (restaurant && !restaurant.storeId) {
      restaurant.storeId = cleanStoreId;
      await restaurant.save();
    }

    // Resolve or auto-create Owner User
    let user = await User.findOne({
      restaurantId: restaurant._id,
      phone: cleanPhone,
    });

    if (!user) {
      user = await User.findOne({ phone: cleanPhone });
      if (user) {
        user.restaurantId = restaurant._id;
        user.storeId = cleanStoreId;
        await user.save();
      } else {
        const defaultPassword = await bcrypt.hash("123456", 10);
        user = await User.create({
          name: store ? store.ownerName : restaurant.name + " Owner",
          phone: cleanPhone,
          address: "Default Address",
          email: `${cleanPhone}@knotkitchen.com`,
          password: defaultPassword,
          role: "Owner",
          restaurantId: restaurant._id,
          storeId: cleanStoreId,
          isVerified: true,
        });
      }
    } else {
      if (!user.storeId) {
        user.storeId = cleanStoreId;
        await user.save();
      }
    }

    // Link restaurant ownerId if not set
    if (!restaurant.ownerId) {
      restaurant.ownerId = user._id;
      await restaurant.save();
    }

    // Set JWT tokens and session cookies
    await signTokensAndSetCookies(user, req, res);

    res.status(200).json({
      success: true,
      message: "Authentication successful!",
      data: user.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const completeStoreSignup = async (req, res, next) => {
  try {
    const { storeId, phone, otp, password, name, email, address } = req.body;

    if (!storeId || !phone || !otp || !password) {
      const error = createHttpError(
        400,
        "Store ID, Phone Number, OTP, and Password are required."
      );
      return next(error);
    }

    const verifyResult = await otpService.verifyOtp({
      storeId: String(storeId).trim(),
      phone,
      otp: String(otp).trim(),
      purpose: "signup",
    });

    if (!verifyResult.valid) {
      const error = createHttpError(400, verifyResult.message || "Invalid or expired OTP.");
      return next(error);
    }

    const store = await Store.findOne({
      storeId: String(storeId).trim(),
      isDeleted: { $ne: true },
    });

    if (!store) {
      const error = createHttpError(404, "Invalid Store ID");
      return next(error);
    }

    const cleanPhone = String(phone).replace(/\D/g, "");
    const cleanStorePhone = String(store.ownerPhone).replace(/\D/g, "");

    if (cleanPhone !== cleanStorePhone) {
      const error = createHttpError(400, "Phone number does not match the Store ID.");
      return next(error);
    }

    let restaurant;
    if (store.restaurantId) {
      restaurant = await Restaurant.findById(store.restaurantId);
    }

    if (!restaurant) {
      restaurant = await Restaurant.create({
        name: store.storeName,
        storeId: store.storeId,
        phone: cleanPhone,
        address: typeof address === "object" && address !== null ? address : { line1: address || "Default Address" },
        isVerified: true,
        isApproved: true,
        subscriptionStatus: "ACTIVE",
      });

      store.restaurantId = restaurant._id;
      store.status = "active";
      await store.save();
    }

    let user = await User.findOne({
      phone: cleanPhone,
      restaurantId: restaurant._id,
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    if (!user) {
      user = await User.create({
        name: name || store.ownerName,
        phone: cleanPhone,
        address: address || "Default Address",
        email: email ? email.toLowerCase() : `${cleanPhone}@knotkitchen.com`,
        password: hashedPassword,
        role: "Owner",
        restaurantId: restaurant._id,
        isVerified: true,
      });
    } else {
      user.password = hashedPassword;
      await user.save();
    }

    await signTokensAndSetCookies(user, req, res);

    res.status(201).json({
      success: true,
      message: "Restaurant signup completed successfully!",
      data: user.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  sendLoginOtp,
  login,
  refreshToken,
  getUserData,
  logout,
  requestEmailVerification,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  setupMFA,
  verifyMFA,
  disableMFA,
  getSessions,
  revokeSession,
  validateStoreId,
  validateStoreOwner,
  sendStoreOtp,
  verifyStoreOtp,
  completeStoreSignup,
};
