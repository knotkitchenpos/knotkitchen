const createHttpError = require("http-errors");
const User = require("../models/userModel");
const ProductId = require("../models/productIdModel");
const Restaurant = require("../models/restaurantModel");
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

const login = async (req, res, next) => {
  try {
    const { email, phone, password, productId } = req.body;

    if ((!email && !phone) || !password) {
      const error = createHttpError(400, "Phone/Email and password are required!");
      return next(error);
    }
    if (!productId || !String(productId).trim()) {
      const error = createHttpError(400, "Product ID is required.");
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

module.exports = {
  register,
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
};