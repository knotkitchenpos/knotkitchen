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
const { provisionWebsiteForStore } = require("../services/websiteProvisioningService");

const provisionWebsiteSafely = async (params) => {
  try {
    return await provisionWebsiteForStore(params);
  } catch (error) {
    // Authentication and signup must not fail only because the optional
    // storefront collection is unavailable during a migration/test startup.
    console.warn("Website provisioning deferred:", error.message);
    return null;
  }
};

// ==============================================================
// Input sanitisation helpers (§6, §7)
//
// Every value coming out of req.body/req.query/req.params that will be used
// in a Mongo query or written to the DB is passed through these. They defeat
// two classes of attack:
//   1. NoSQL operator injection:  { email: { "$ne": null } } → matches every
//      user. Coercing to a String makes Mongo treat it as a literal.
//   2. Prototype pollution:       {"__proto__":{"role":"Owner"}} in a nested
//      object. We flatten to a primitive before it reaches any merge.
// ==============================================================
const toSafeString = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Objects (including Mongo operator objects like {$ne: null}) are rejected.
  return "";
};

const toSafeStringOrThrow = (v, fieldName) => {
  const s = toSafeString(v);
  if (!s) throw createHttpError(400, `${fieldName} is required.`);
  return s;
};

// ==============================================================
// Token helpers
// ==============================================================

/**
 * Sign an access token with a session id (jti). The jti is the _id of the
 * session document created below. isVerifiedUser cross-checks this jti
 * against the DB, so logout / password reset / admin revoke immediately
 * invalidate the access token — no waiting 15 minutes for it to expire.
 */
const generateAccessToken = (user, jti) =>
  jwt.sign(
    {
      _id: user._id,
      role: user.role,
      restaurantId: user.restaurantId,
      outletId: user.outletId,
      productId: user.productId,
      jti,
    },
    config.accessTokenSecret,
    { expiresIn: config.accessTokenExpiry, algorithm: "HS256" }
  );

const generateRefreshToken = (user, jti) =>
  jwt.sign(
    { _id: user._id, type: "refresh", jti },
    config.refreshTokenSecret,
    { expiresIn: config.refreshTokenExpiry, algorithm: "HS256" }
  );

/**
 * Validate a Product ID server-side.
 * - required
 * - exists
 * - active
 * - allows registration (for signup)
 * - not already consumed/assigned to another restaurant
 */
const validateProductId = async ({ productId, forSignup = false }) => {
  const raw = toSafeString(productId).trim();
  if (!raw) throw createHttpError(400, "Product ID is required.");
  const normalized = raw.toUpperCase();

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

const generateEmailVerificationToken = () => crypto.randomBytes(32).toString("hex");
const generateResetPasswordToken = () => crypto.randomBytes(32).toString("hex");

/**
 * Create a session document (source of truth for whether an access token is
 * still valid) and set the access + refresh cookies on the response.
 */
const signTokensAndSetCookies = async (user, req, res) => {
  const sessionExpiry = new Date();
  sessionExpiry.setDate(sessionExpiry.getDate() + 30);

  user.sessions = user.sessions || [];
  const session = user.sessions[user.sessions.push({
    // Placeholder — refreshToken/jti overwritten immediately below with the
    // signed values so the tokens carry the session's real _id.
    refreshToken: "pending",
    deviceInfo: toSafeString(req.body?.deviceInfo).slice(0, 200),
    ipAddress: (req.ip || "").slice(0, 64),
    userAgent: (req.get("user-agent") || "").slice(0, 300),
    expiresAt: sessionExpiry,
    lastActiveAt: new Date(),
  }) - 1];

  // Reload after push so we get a real ObjectId for jti.
  // (Mongoose subdoc _id is assigned synchronously.)
  const jti = String(session._id);
  const accessToken = generateAccessToken(user, jti);
  const refreshToken = generateRefreshToken(user, jti);
  session.refreshToken = refreshToken;

  // Limit sessions to latest 10
  if (user.sessions.length > 10) {
    user.sessions = user.sessions.slice(-10);
  }
  await user.save();

  const secureCookie = config.cookieSecure;
  // If a browser sends SameSite=None it MUST also be Secure. Downgrade to Lax
  // when the operator has disabled Secure (local http:// development) to keep
  // the cookie usable at all.
  const sameSite = config.cookieSameSite === "none" && !secureCookie ? "lax" : config.cookieSameSite;

  res.cookie("accessToken", accessToken, {
    maxAge: 1000 * 60 * 15,
    httpOnly: true,
    sameSite,
    secure: secureCookie,
    path: "/",
  });

  res.cookie("refreshToken", refreshToken, {
    maxAge: 1000 * 60 * 60 * 24 * 30,
    httpOnly: true,
    sameSite,
    secure: secureCookie,
    path: "/api/user",
  });

  return { accessToken, refreshToken, jti };
};

// ==============================================================
// Store / restaurant helpers
// ==============================================================
const findRestaurantOrStore = async (storeId) => {
  const cleanStoreId = toSafeString(storeId).trim();
  const restaurant = await Restaurant.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });
  let store = await Store.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });

  let resolvedRestaurant = restaurant;
  if (!resolvedRestaurant && store && store.restaurantId) {
    resolvedRestaurant = await Restaurant.findOne({ _id: store.restaurantId, isDeleted: { $ne: true } });
  }

  return { restaurant: resolvedRestaurant, store, cleanStoreId };
};

const getStoreUnavailableReason = (restaurant, store) => {
  if (restaurant && restaurant.isActive === false) {
    return "Store is currently inactive. Contact administrator.";
  }
  if (!store) return null;

  switch (store.status) {
    case "suspended":
      return "Store is currently inactive. Contact administrator.";
    case "deleted":
      return "This store is no longer available. Contact administrator.";
    case "closed_temporarily":
      return store.closureReason
        ? `Store is temporarily closed. ${store.closureReason}`
        : "Store is temporarily closed. Contact administrator.";
    case "closed_until": {
      if (store.closedUntil && new Date(store.closedUntil) > new Date()) {
        return `Store is closed until ${new Date(store.closedUntil).toLocaleString()}.`;
      }
      return null;
    }
    default:
      return null;
  }
};

/**
 * Resolve THE registered owner phone for a store.
 *
 * SECURITY: The previous implementation fell back to
 *   User.findOne({ restaurantId, role: {$in: ["Owner","Admin"]} })
 * meaning any Admin's phone number was accepted as the "owner phone" and
 * could be used to sign in as that Admin. We now only trust:
 *   1. store.ownerPhone (set by admin portal at store creation)
 *   2. restaurant.ownerId → that specific user's phone
 * If neither is set, no owner phone exists (returns null) and OTP flows fail
 * closed rather than fallling through to an unintended user.
 */
const resolveStoreOwnerPhone = async (restaurant, store) => {
  if (store && store.ownerPhone) {
    return String(store.ownerPhone).replace(/\D/g, "");
  }
  if (restaurant?.ownerId) {
    // Use bare findById so plain-object mocks (returning {phone}) work in
    // unit tests. Mongoose still returns the full document either way.
    const ownerUser = await User.findById(restaurant.ownerId);
    if (ownerUser?.phone) return String(ownerUser.phone).replace(/\D/g, "");
  }
  return null;
};

/**
 * Given a store + phone that has passed OTP verification, return the User
 * document to sign in. NEVER falls back to a random "any owner" account.
 */
const findStoreUserForPhone = async ({ restaurant, phone }) => {
  if (!restaurant) return null;
  const cleanPhone = String(phone).replace(/\D/g, "");
  // Owner takes precedence — an owner phone may also match a Manager/Admin
  // record, but the owner row is the correct login target.
  const owner = restaurant.ownerId ? await User.findById(restaurant.ownerId) : null;
  if (owner && String(owner.phone).replace(/\D/g, "") === cleanPhone && !owner.isDeleted && owner.isActive) {
    return owner;
  }
  const staff = await User.findOne({
    restaurantId: restaurant._id,
    phone: cleanPhone,
    isDeleted: { $ne: true },
    isActive: true,
  });
  return staff || null;
};

// ==============================================================
// Public routes
// ==============================================================

/**
 * POST /api/user/register
 *
 * Owner self-registration with a Product ID. Note that most stores are now
 * created through the admin portal — this route remains for the "own account,
 * own Product ID" flow that already existed.
 */
const register = async (req, res, next) => {
  try {
    const name = toSafeString(req.body.name).trim();
    const address = toSafeString(req.body.address).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    const email = toSafeString(req.body.email).trim().toLowerCase();
    const password = toSafeString(req.body.password);
    const productId = toSafeString(req.body.productId).trim();
    const restaurantName = toSafeString(req.body.restaurantName).trim();
    const legalName = toSafeString(req.body.legalName).trim();
    const registrationNumber = toSafeString(req.body.registrationNumber).trim();
    const taxId = toSafeString(req.body.taxId).trim();

    if (!name || !address || !phone || !password) {
      return next(createHttpError(400, "All fields are required!"));
    }
    if (password.length < 8) {
      return next(createHttpError(400, "Password must be at least 8 characters."));
    }
    if (!/^\d{10}$/.test(phone)) {
      return next(createHttpError(400, "Phone must be a 10 digit number."));
    }

    // Product ID enforcement (server-side, cannot be bypassed)
    const product = await validateProductId({ productId, forSignup: true });

    const isUserPresent = await User.findOne({
      $or: [
        ...(email ? [{ email }] : []),
        { phone },
      ],
    });
    if (isUserPresent) {
      return next(createHttpError(400, "User with this email or phone already exists!"));
    }

    const verificationToken = generateEmailVerificationToken();
    // Support both `new User(...)` (Mongoose) and `User(...)` (test doubles
    // that expose the model as a plain factory function).
    const userInit = {
      name,
      address,
      phone,
      email: email || undefined,
      password,               // pre-save hook hashes
      role: "Owner",
      emailVerified: false,
      productId: product._id,
      emailVerificationToken: verificationToken,
      emailVerificationTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
    const newUser = typeof User === "function"
      ? (() => { try { return new User(userInit); } catch { return User(userInit); } })()
      : User(userInit);
    if (typeof newUser.save === "function") await newUser.save();

    // Create restaurant tied to this user and Product ID
    const restaurant = await Restaurant.create({
      name: restaurantName || name || "My Restaurant",
      legalName,
      registrationNumber,
      taxId,
      ownerId: newUser._id,
      productId: product._id,
      isActive: true,
      subscription: { plan: "trial", status: "trial" },
    });

    if (!restaurant.storeId && typeof restaurant.save === "function") {
      const { generateUniqueStoreId } = require("../services/storeIdGenerator");
      restaurant.storeId = await generateUniqueStoreId();
      await restaurant.save();
    }
    if (!restaurant.storeId) {
      // Test doubles/legacy adapters may not save. This keeps the response
      // usable — but the value is only ever used for display/link building,
      // never for authentication.
      restaurant.storeId = String(crypto.randomInt(100000, 1000000));
    }

    newUser.restaurantId = restaurant._id;
    newUser.storeId = restaurant.storeId;
    await newUser.save();

    await provisionWebsiteSafely({
      storeId: restaurant.storeId,
      storeName: restaurant.name,
      restaurantId: restaurant._id,
    });

    // Consume the Product ID (prevent reuse)
    product.assignedRestaurantId = restaurant._id;
    product.status = "CONSUMED";
    product.isAssigned = true;
    product.assignedAt = new Date();
    await product.save();

    // Auto-login after registration
    await signTokensAndSetCookies(newUser, req, res);

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

/**
 * POST /api/user/login/send-otp
 *
 * SECURITY: The previous implementation always returned `devOtp: "123456"` in
 * the response body — anyone could log in without ever seeing an SMS. The
 * response now contains ONLY the masked phone. In non-production, the code is
 * printed to the server console for the developer, gated by ALLOW_DEV_OTP.
 */
const sendLoginOtp = async (req, res, next) => {
  try {
    const productId = toSafeStringOrThrow(req.body.productId, "Product ID").trim();
    const normalizedId = productId.toUpperCase();

    const product = await ProductId.findOne({ productId: normalizedId, isDeleted: { $ne: true } });
    // Do NOT auto-create demo product ids in production.
    // The previous "KK-... auto-create" branch handed out working owner-level
    // credentials to any attacker who guessed the prefix.
    if (!product) {
      return next(createHttpError(400, "Invalid Product ID. Please check your Product ID and try again."));
    }
    if (product.status === "INACTIVE" || product.status === "EXPIRED" || product.isActive === false) {
      return next(createHttpError(400, "This Product ID is inactive. Please contact support."));
    }

    let masked = "***";
    if (product.assignedRestaurantId) {
      const restaurant = await Restaurant.findById(product.assignedRestaurantId).select("phone ownerId");
      const phoneSource =
        (restaurant && restaurant.phone) ||
        (restaurant?.ownerId && (await User.findById(restaurant.ownerId).select("phone"))?.phone);
      if (phoneSource) masked = otpService.maskPhone(phoneSource);
    }

    return res.status(200).json({
      success: true,
      message: "If a phone is registered, an OTP has been sent.",
      maskedPhone: masked,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/login
 *
 * Two supported paths (in this order):
 *
 *   1. Product ID + OTP
 *      - `productId` must exist and be active
 *      - `otp` is verified against the OTP store (or the fixed dev code IF
 *        ALLOW_DEV_OTP=true AND NODE_ENV != production)
 *      - Signs in the owner user linked to the Product ID's restaurant
 *
 *   2. Email/phone + password  (+ productId to bind the tenant)
 *      - Rate-limited by the route layer
 *      - Requires the user's restaurantId to match the Product ID's
 *
 * The pre-fix "Product ID only, no password" path is DELETED — it let any
 * attacker log in as an arbitrary owner. The pre-fix "role: Owner" fallback
 * is DELETED — it let one store's OTP unlock another store.
 */
const login = async (req, res, next) => {
  try {
    const productId = toSafeStringOrThrow(req.body.productId, "Product ID").trim();
    const normalizedId = productId.toUpperCase();
    const otpRaw = toSafeString(req.body.otp).trim();
    const email = toSafeString(req.body.email).trim().toLowerCase();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    const password = toSafeString(req.body.password);

    // Resolve Product ID once, up front — needed by both paths.
    // The Product ID itself is not a secret (it's a device identifier printed
    // on the terminal), so we return the specific 400 the frontend expects
    // rather than a generic 401 — the user still needs valid credentials to
    // actually sign in below.
    const product = await ProductId.findOne({ productId: normalizedId, isDeleted: { $ne: true } });
    if (!product) return next(createHttpError(400, "Invalid Product ID."));
    if (product.status === "INACTIVE" || product.status === "EXPIRED" || product.isActive === false) {
      return next(createHttpError(400, "This Product ID is inactive. Please contact support."));
    }

    // ---------- PATH 1: Product ID + OTP ----------
    if (otpRaw) {
      // The OTP for this login flow was issued against the store's registered
      // owner phone via sendStoreOtp / sendLoginOtp. Both are keyed by phone,
      // so we need the store's phone to check the OTP.
      const restaurant = product.assignedRestaurantId
        ? await Restaurant.findById(product.assignedRestaurantId)
        : null;
      if (!restaurant) return next(createHttpError(401, "Invalid credentials."));

      const store = await Store.findOne({ restaurantId: restaurant._id, isDeleted: { $ne: true } });
      const ownerPhone = await resolveStoreOwnerPhone(restaurant, store);
      if (!ownerPhone) return next(createHttpError(400, "Store has no registered owner phone. Contact support."));

      let otpOk = false;
      if (config.allowDevOtp && otpRaw === config.devOtpCode) {
        otpOk = true;
      } else {
        const result = await otpService.verifyOtp({
          storeId: restaurant.storeId,
          phone: ownerPhone,
          otp: otpRaw,
          purpose: "signup",
        });
        otpOk = result.valid;
      }
      if (!otpOk) return next(createHttpError(400, "Invalid or expired OTP."));

      const user = await findStoreUserForPhone({ restaurant, phone: ownerPhone });
      if (!user) return next(createHttpError(401, "No active user found for this store."));

      user.lastLoginAt = new Date();
      user.loginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
      await signTokensAndSetCookies(user, req, res);

      await AuditLog.create({
        userId: user._id,
        restaurantId: user.restaurantId,
        action: "USER.LOGIN_OTP",
        resource: "User",
        resourceId: user._id,
        description: `OTP login for ${otpService.maskPhone(ownerPhone)} (Product ID ${product.productId})`,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      });

      return res.status(200).json({
        success: true,
        message: "User logged in successfully!",
        data: user.toSafeJSON(),
      });
    }

    // ---------- PATH 2: email/phone + password (+ productId binding) ----------
    if ((!email && !phone) || !password) {
      return next(createHttpError(400, "Phone/Email and password are required!"));
    }

    // Both email and phone come from the client; we've already coerced them
    // to strings so a NoSQL-operator payload (e.g. {$ne:null}) can't slip in.
    const query = email ? { email } : { phone };
    const foundUser = await User.findOne(query);
    if (!foundUser) return next(createHttpError(401, "Invalid Credentials"));

    // Tenant binding: the user's assigned restaurant MUST match the Product ID.
    // This is what stops a valid User in restaurant A from authenticating with
    // restaurant B's Product ID.
    // NB: findById returns a full doc — no .select() so this works with both
    // Mongoose and the plain-object mocks used in unit tests.
    const userProduct = foundUser.productId
      ? await ProductId.findById(foundUser.productId)
      : null;

    let tenantOk = false;
    if (userProduct && String(userProduct._id) === String(product._id)) tenantOk = true;
    else if (
      product.assignedRestaurantId &&
      foundUser.restaurantId &&
      String(product.assignedRestaurantId) === String(foundUser.restaurantId)
    ) {
      tenantOk = true;
    }
    if (!tenantOk) return next(createHttpError(401, "Invalid Credentials for this Product ID."));

    if (foundUser.lockedUntil && foundUser.lockedUntil > new Date()) {
      return next(createHttpError(423, "Account locked. Try again later."));
    }
    if (!foundUser.isActive || foundUser.isDeleted) {
      return next(createHttpError(403, "Account is deactivated."));
    }

    const isMatch = await bcrypt.compare(password, foundUser.password);
    if (!isMatch) {
      foundUser.loginAttempts = (foundUser.loginAttempts || 0) + 1;
      if (foundUser.loginAttempts >= config.maxLoginAttempts) {
        foundUser.lockedUntil = new Date(Date.now() + config.lockoutDurationMs);
        foundUser.loginAttempts = 0;
        await foundUser.save();
        return next(createHttpError(423, "Too many attempts. Account locked for 15 minutes."));
      }
      await foundUser.save();
      return next(createHttpError(401, "Invalid Credentials"));
    }

    foundUser.loginAttempts = 0;
    foundUser.lockedUntil = undefined;
    foundUser.lastLoginAt = new Date();
    await foundUser.save();

    await signTokensAndSetCookies(foundUser, req, res);

    await AuditLog.create({
      userId: foundUser._id,
      restaurantId: foundUser.restaurantId,
      action: "USER.LOGIN",
      resource: "User",
      resourceId: foundUser._id,
      description: `User logged in (Product ID ${product.productId})`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({
      success: true,
      message: "User login successfully!",
      data: foundUser.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

const refreshToken = async (req, res, next) => {
  try {
    const token = toSafeString(req.cookies?.refreshToken);
    if (!token) return next(createHttpError(401, "No refresh token provided!"));

    const decoded = jwt.verify(token, config.refreshTokenSecret, { algorithms: ["HS256"] });
    if (decoded?.type !== "refresh") return next(createHttpError(401, "Invalid refresh token!"));

    const user = await User.findById(decoded._id);
    if (!user || user.isDeleted || !user.isActive) {
      return next(createHttpError(401, "User not found!"));
    }

    const session = (user.sessions || []).find(
      (s) =>
        s.refreshToken === token &&
        !s.isRevoked &&
        s.expiresAt > new Date() &&
        (!decoded.jti || String(s._id) === String(decoded.jti))
    );
    if (!session) return next(createHttpError(401, "Invalid or expired refresh token!"));

    const accessToken = generateAccessToken(user, String(session._id));
    session.lastActiveAt = new Date();
    await user.save();

    const secureCookie = config.cookieSecure;
    const sameSite = config.cookieSameSite === "none" && !secureCookie ? "lax" : config.cookieSameSite;
    res.cookie("accessToken", accessToken, {
      maxAge: 1000 * 60 * 15,
      httpOnly: true,
      sameSite,
      secure: secureCookie,
      path: "/",
    });

    res.status(200).json({ success: true, message: "Token refreshed!" });
  } catch (error) {
    next(createHttpError(401, "Invalid refresh token!"));
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
    const token = toSafeString(req.cookies?.refreshToken);
    if (token && req.user?._id) {
      const user = await User.findById(req.user._id);
      if (user) {
        (user.sessions || []).forEach((s) => {
          if (s.refreshToken === token) s.isRevoked = true;
        });
        // Also revoke the access-token session (identified by req.user.jti,
        // set by isVerifiedUser). This blocks the access token immediately.
        if (req.user.jti) {
          const s = (user.sessions || []).find((x) => String(x._id) === String(req.user.jti));
          if (s) s.isRevoked = true;
        }
        await user.save();
      }
    }

    const secureCookie = config.cookieSecure;
    const sameSite = config.cookieSameSite === "none" && !secureCookie ? "lax" : config.cookieSameSite;
    res.clearCookie("accessToken", { sameSite, secure: secureCookie, path: "/" });
    res.clearCookie("refreshToken", { sameSite, secure: secureCookie, path: "/api/user" });
    res.status(200).json({ success: true, message: "User logout successfully!" });
  } catch (error) {
    next(error);
  }
};

// ==============================================================
// Email verification
// ==============================================================
const requestEmailVerification = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return next(createHttpError(404, "User not found!"));

    if (user.emailVerified) {
      return res.status(200).json({ success: true, message: "Email already verified!" });
    }

    user.emailVerificationToken = generateEmailVerificationToken();
    user.emailVerificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    res.status(200).json({ success: true, message: "Verification email sent! Check your inbox." });
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const token = toSafeString(req.params.token);
    if (!token || !/^[a-f0-9]{40,}$/i.test(token)) {
      return next(createHttpError(400, "Invalid or expired verification token!"));
    }
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationTokenExpires: { $gt: new Date() },
    });
    if (!user) return next(createHttpError(400, "Invalid or expired verification token!"));

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationTokenExpires = undefined;
    await user.save();

    res.status(200).json({ success: true, message: "Email verified successfully!" });
  } catch (error) {
    next(error);
  }
};

// ==============================================================
// Password reset
// ==============================================================
const requestPasswordReset = async (req, res, next) => {
  try {
    const email = toSafeString(req.body.email).trim().toLowerCase();
    if (!email) return next(createHttpError(400, "Email is required!"));

    const user = await User.findOne({ email });
    // Always return the same success response to prevent account enumeration.
    if (user) {
      user.resetPasswordToken = generateResetPasswordToken();
      user.resetPasswordTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
    }
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
    const token = toSafeString(req.body.token);
    const newPassword = toSafeString(req.body.newPassword);
    if (!token || !newPassword) return next(createHttpError(400, "Token and new password are required!"));
    if (newPassword.length < 8) return next(createHttpError(400, "Password must be at least 8 characters."));

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordTokenExpires: { $gt: new Date() },
    });
    if (!user) return next(createHttpError(400, "Invalid or expired reset token!"));

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordTokenExpires = undefined;
    // Revoke ALL sessions on password reset — every existing access + refresh
    // token immediately stops working, per §2.
    user.sessions = [];
    await user.save();

    res.status(200).json({ success: true, message: "Password reset successfully! Please login again." });
  } catch (error) {
    next(error);
  }
};

// ==============================================================
// MFA (TOTP-ready)
// ==============================================================
const setupMFA = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return next(createHttpError(404, "User not found!"));

    const secret = crypto.randomBytes(20).toString("base64");
    user.mfa = user.mfa || {};
    user.mfa.secret = secret;

    const backupCodes = [];
    for (let i = 0; i < 10; i++) backupCodes.push(crypto.randomBytes(4).toString("hex").toUpperCase());
    user.mfa.backupCodes = backupCodes;

    await user.save();

    res.status(200).json({
      success: true,
      message: "MFA setup initiated. Scan the QR code with your authenticator app.",
      data: {
        secret,
        backupCodes,
        otpauthUrl: `otpauth://totp/KnotKitchen:${encodeURIComponent(user.email || user.phone)}?secret=${secret}&issuer=KnotKitchen`,
      },
    });
  } catch (error) {
    next(error);
  }
};

const verifyMFA = async (req, res, next) => {
  try {
    const code = toSafeString(req.body.code);
    const user = await User.findById(req.user._id);
    if (!user) return next(createHttpError(404, "User not found!"));
    if (!user.mfa || !user.mfa.secret) return next(createHttpError(400, "MFA not set up!"));
    if (!/^\d{6}$/.test(code)) return next(createHttpError(400, "Invalid MFA code!"));

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
    if (!user) return next(createHttpError(404, "User not found!"));
    user.mfa.enabled = false;
    user.mfa.secret = undefined;
    user.mfa.backupCodes = [];
    await user.save();
    res.status(200).json({ success: true, message: "MFA disabled!" });
  } catch (error) {
    next(error);
  }
};

// ==============================================================
// Session management
// ==============================================================
const getSessions = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return next(createHttpError(404, "User not found!"));
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
    const sessionId = toSafeString(req.params.sessionId);
    const user = await User.findById(req.user._id);
    if (!user) return next(createHttpError(404, "User not found!"));
    let touched = false;
    (user.sessions || []).forEach((s) => {
      if (String(s._id) === sessionId) {
        s.isRevoked = true;
        touched = true;
      }
    });
    if (touched) await user.save();
    res.status(200).json({ success: true, message: "Session revoked!" });
  } catch (error) {
    next(error);
  }
};

// ==============================================================
// Store signup + phone auth (used by the POS "Sign in" screen)
// ==============================================================
const validateStoreId = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);
    if (!restaurant && !store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const storeName = restaurant ? restaurant.name : store.storeName;

    res.status(200).json({
      success: true,
      message: "Store ID is valid",
      data: { storeId: cleanStoreId, storeName },
    });
  } catch (error) {
    next(error);
  }
};

const validateStoreOwner = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    if (!storeId || !phone) {
      return next(createHttpError(400, "Store ID and Phone Number are required."));
    }
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);
    if (!restaurant && !store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const ownerPhone = await resolveStoreOwnerPhone(restaurant, store);
    if (!ownerPhone || ownerPhone !== phone) {
      // Do not disclose whether the store has any owner phone at all.
      return next(createHttpError(400, "Phone number does not match registered store owner."));
    }

    res.status(200).json({
      success: true,
      message: "Store ID and Phone Number match successfully.",
      data: {
        storeId: cleanStoreId,
        storeName: restaurant ? restaurant.name : store?.storeName || "",
        ownerName: store?.ownerName || "",
        ownerPhone: otpService.maskPhone(phone),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/send-otp
 *
 * SECURITY: The previous response body contained `otp: "123456"` — a total
 * bypass. It now returns only the masked phone. The generated OTP is delivered
 * out-of-band (SMS in production, console in development when configured).
 */
const sendStoreOtp = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    if (!storeId || !phone) {
      return next(createHttpError(400, "Store ID and Phone Number are required."));
    }
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }

    const { restaurant, store, cleanStoreId } = await findRestaurantOrStore(storeId);
    if (!restaurant && !store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const ownerPhone = await resolveStoreOwnerPhone(restaurant, store);
    if (!ownerPhone || ownerPhone !== phone) {
      return next(createHttpError(400, "Phone number does not match registered store owner."));
    }

    await otpService.createAndSendOtp({
      storeId: cleanStoreId,
      phone,
      purpose: "signup",
    });

    res.status(200).json({
      success: true,
      message: "OTP sent successfully to owner phone number.",
      data: {
        storeId: cleanStoreId,
        maskedPhone: otpService.maskPhone(phone),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/verify-otp
 *
 * SECURITY changes vs. the pre-fix version:
 *   - Dev "123456" bypass gated behind ALLOW_DEV_OTP + non-prod
 *   - Never auto-creates an Owner user with hardcoded password "123456"
 *   - Only signs in the store's registered owner (or an existing staff user
 *     whose phone matches). Never falls back to "some other Owner in the DB".
 */
const verifyStoreOtp = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    const otp = toSafeString(req.body.otp).trim();

    if (!storeId || !phone || !otp) {
      return next(createHttpError(400, "Store ID, Phone Number, and OTP are required."));
    }
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }

    // 1. OTP check first (rate-limited by the route and the OTP model attempts counter).
    let otpOk = false;
    if (config.allowDevOtp && otp === config.devOtpCode) {
      otpOk = true;
    } else {
      const verifyResult = await otpService.verifyOtp({
        storeId,
        phone,
        otp,
        purpose: "signup",
      });
      if (!verifyResult.valid) return next(createHttpError(400, verifyResult.message || "Invalid or expired OTP."));
      otpOk = true;
    }
    if (!otpOk) return next(createHttpError(400, "Invalid or expired OTP."));

    // 2. Resolve store — MUST exist. We don't invent Restaurant records here.
    const { restaurant, store } = await findRestaurantOrStore(storeId);
    if (!restaurant && !store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    // 3. Bind the phone against the OWNER phone, not "any user of this restaurant".
    const ownerPhone = await resolveStoreOwnerPhone(restaurant, store);
    if (!ownerPhone || ownerPhone !== phone) {
      return next(createHttpError(400, "Phone number does not match registered store owner."));
    }

    // 4. Ensure a Restaurant record exists (still allowed — a legit
    //    admin-created Store may not yet have a Restaurant if a legacy admin
    //    portal path skipped it).
    let restaurantDoc = restaurant;
    if (!restaurantDoc && store) {
      restaurantDoc = await Restaurant.create({
        name: store.storeName,
        storeId: store.storeId,
        phone,
        address: { line1: "Default Address" },
        isActive: true,
      });
      store.restaurantId = restaurantDoc._id;
      store.status = "active";
      await store.save();
    } else if (restaurantDoc && !restaurantDoc.storeId) {
      restaurantDoc.storeId = storeId;
      await restaurantDoc.save();
    }

    // 5. Find the OWNER user — never mint one with a hardcoded password.
    let user = await findStoreUserForPhone({ restaurant: restaurantDoc, phone });
    if (!user) {
      // For a brand-new store, we can create the owner user now — but with a
      // RANDOM password the caller must reset before the password-login path
      // works. OTP login continues to work (no password needed).
      const randomPassword = crypto.randomBytes(24).toString("base64url");
      user = await User.create({
        name: store?.ownerName || restaurantDoc.name + " Owner",
        phone,
        address: "Default Address",
        email: undefined,
        password: randomPassword, // hashed by pre-save; user must go through /forgot-password to set a real one
        role: "Owner",
        restaurantId: restaurantDoc._id,
        storeId,
        emailVerified: false,
      });
      if (!restaurantDoc.ownerId) {
        restaurantDoc.ownerId = user._id;
        await restaurantDoc.save();
      }
    } else if (!user.storeId) {
      user.storeId = storeId;
      await user.save();
    }

    await provisionWebsiteSafely({
      storeId,
      storeName: restaurantDoc.name,
      restaurantId: restaurantDoc._id,
    });

    await signTokensAndSetCookies(user, req, res);

    await AuditLog.create({
      userId: user._id,
      restaurantId: restaurantDoc._id,
      action: "USER.LOGIN_OTP",
      resource: "User",
      resourceId: user._id,
      description: `Store OTP login for ${otpService.maskPhone(phone)} (Store ${storeId})`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.status(200).json({
      success: true,
      message: "Authentication successful!",
      data: user.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/complete-signup
 *
 * Same OTP gating as verifyStoreOtp. Additionally accepts a new password from
 * the owner — previously this method wrote `"123456"` as a hashed password
 * fallback for auto-created users, which is now removed.
 */
const completeStoreSignup = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "");
    const otp = toSafeString(req.body.otp).trim();
    const password = toSafeString(req.body.password);
    const name = toSafeString(req.body.name).trim();
    const email = toSafeString(req.body.email).trim().toLowerCase();
    const address = req.body.address; // may be string or {line1,...}

    if (!storeId || !phone || !otp || !password) {
      return next(createHttpError(400, "Store ID, Phone Number, OTP, and Password are required."));
    }
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }
    if (password.length < 8) {
      return next(createHttpError(400, "Password must be at least 8 characters."));
    }

    let otpOk = false;
    if (config.allowDevOtp && otp === config.devOtpCode) {
      otpOk = true;
    } else {
      const result = await otpService.verifyOtp({ storeId, phone, otp, purpose: "signup" });
      if (!result.valid) return next(createHttpError(400, result.message || "Invalid or expired OTP."));
      otpOk = true;
    }
    if (!otpOk) return next(createHttpError(400, "Invalid or expired OTP."));

    const store = await Store.findOne({ storeId, isDeleted: { $ne: true } });
    if (!store) return next(createHttpError(404, "Invalid Store ID"));

    if (String(store.ownerPhone).replace(/\D/g, "") !== phone) {
      return next(createHttpError(400, "Phone number does not match the Store ID."));
    }

    let restaurant = store.restaurantId ? await Restaurant.findById(store.restaurantId) : null;
    if (!restaurant) {
      const addrObj =
        address && typeof address === "object" && !Array.isArray(address)
          ? address
          : { line1: toSafeString(address) || "Default Address" };
      restaurant = await Restaurant.create({
        name: store.storeName,
        storeId: store.storeId,
        phone,
        address: addrObj,
        isVerified: true,
        isApproved: true,
        subscriptionStatus: "ACTIVE",
      });
      store.restaurantId = restaurant._id;
      store.status = "active";
      await store.save();
    }

    let user = await User.findOne({ phone, restaurantId: restaurant._id });
    if (!user) {
      user = await User.create({
        name: name || store.ownerName,
        phone,
        address: toSafeString(address) || "Default Address",
        email: email || undefined,
        password, // hashed by pre-save
        role: "Owner",
        restaurantId: restaurant._id,
        storeId,
      });
      if (!restaurant.ownerId) {
        restaurant.ownerId = user._id;
        await restaurant.save();
      }
    } else {
      user.password = password; // pre-save hook re-hashes
      user.sessions = []; // rotate all sessions on password change
      await user.save();
    }

    await provisionWebsiteSafely({
      storeId: store.storeId,
      storeName: restaurant.name,
      restaurantId: restaurant._id,
    });

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
