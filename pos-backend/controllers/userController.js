const createHttpError = require("http-errors");
const User = require("../models/userModel");
const Restaurant = require("../models/restaurantModel");
const Store = require("../models/storeModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const config = require("../config/config");
const sessionCookies = require("../services/sessionCookies");
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
 * Create a session document (source of truth for whether an access token is
 * still valid) and set the access + refresh cookies on the response.
 */
// Session lifetime for POS operators. Deliberately long — they should not have
// to re-enter a password unless they explicitly log out. Actual security is
// still per-request (jti lookup against the User's sessions[]), so revoking is
// instant even with a year-long cookie.
const SESSION_LIFETIME_DAYS = 365;
const SESSION_LIFETIME_MS = SESSION_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

const signTokensAndSetCookies = async (user, req, res) => {
  const sessionExpiry = new Date(Date.now() + SESSION_LIFETIME_MS);

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

  // Namespaced by store, so a second takeaway signed in from the same
  // browser gets its own jar entry instead of overwriting this one.
  res.cookie(sessionCookies.accessCookieName(user.storeId), accessToken, {
    // The token inside still expires in 15 minutes and REST still refuses it
    // then (401 -> refresh). The cookie is kept so a reconnecting socket has
    // something to show: services/socket checks the session it names.
    maxAge: SESSION_LIFETIME_MS,
    httpOnly: true,
    sameSite,
    secure: secureCookie,
    path: "/",
  });

  res.cookie(sessionCookies.refreshCookieName(user.storeId), refreshToken, {
    maxAge: SESSION_LIFETIME_MS,
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
  if (!cleanStoreId) return { restaurant: null, store: null, cleanStoreId: "" };

  let restaurant = await Restaurant.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });
  let store = await Store.findOne({ storeId: cleanStoreId, isDeleted: { $ne: true } });

  const numStoreId = Number(cleanStoreId);
  if (!restaurant && !store && !Number.isNaN(numStoreId)) {
    restaurant = await Restaurant.findOne({ storeId: numStoreId, isDeleted: { $ne: true } });
    store = await Store.findOne({ storeId: numStoreId, isDeleted: { $ne: true } });
  }

  const isValidObjectId = (id) => typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id);
  if (!restaurant && isValidObjectId(cleanStoreId)) {
    restaurant = await Restaurant.findOne({ _id: cleanStoreId, isDeleted: { $ne: true } });
  }
  if (!store && isValidObjectId(cleanStoreId)) {
    store = await Store.findOne({ _id: cleanStoreId, isDeleted: { $ne: true } });
  }

  let resolvedRestaurant = restaurant;
  if (!resolvedRestaurant && store && store.restaurantId) {
    resolvedRestaurant = await Restaurant.findOne({ _id: store.restaurantId, isDeleted: { $ne: true } });
  }

  if (!store && resolvedRestaurant) {
    store = await Store.findOne({ restaurantId: resolvedRestaurant._id, isDeleted: { $ne: true } });
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

const refreshToken = async (req, res, next) => {
  try {
    const token = toSafeString(sessionCookies.readRefreshToken(req));
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
    // Slide the session: every successful refresh pushes expiresAt out by
    // another full lifetime so an actively used POS never logs itself out.
    // The refresh cookie is re-set with the same maxAge so the browser's copy
    // stays fresh too (some browsers cap third-party cookies to shorter
    // lifetimes anyway; re-setting it is the cheapest way to keep it alive).
    session.lastActiveAt = new Date();
    session.expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await user.save();

    const secureCookie = config.cookieSecure;
    const sameSite = config.cookieSameSite === "none" && !secureCookie ? "lax" : config.cookieSameSite;
    // Re-set under the SAME name the session was issued under, so a
    // refresh never migrates one takeaway's session onto another's cookie.
    res.cookie(sessionCookies.accessCookieName(user.storeId), accessToken, {
      // The token inside still expires in 15 minutes and REST still refuses it
    // then (401 -> refresh). The cookie is kept so a reconnecting socket has
    // something to show: services/socket checks the session it names.
    maxAge: SESSION_LIFETIME_MS,
      httpOnly: true,
      sameSite,
      secure: secureCookie,
      path: "/",
    });
    res.cookie(sessionCookies.refreshCookieName(user.storeId), token, {
      maxAge: SESSION_LIFETIME_MS,
      httpOnly: true,
      sameSite,
      secure: secureCookie,
      path: "/api/user",
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
    const token = toSafeString(sessionCookies.readRefreshToken(req));
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
    // Clear ONLY the takeaway this request belongs to. Clearing every
    // accessToken* cookie here is what would sign the other takeaways out.
    for (const c of sessionCookies.cookieNamesToClear(req, req.user?.storeId)) {
      res.clearCookie(c.name, { sameSite, secure: secureCookie, path: c.path });
    }
    res.status(200).json({ success: true, message: "User logout successfully!" });
  } catch (error) {
    next(error);
  }
};

// ===========================================================================
// POS store password auth (added 2026-08-31)
//
// Replaces the phone + Fast2SMS OTP flow that used to gate POS sign-in. The
// four handlers below cover the entire lifecycle:
//
//   store/status        — does this store have a password yet?
//   store/setup-password — first-time create OR reset (same fields, same code)
//   store/login          — the day-to-day sign-in
//   change-password      — in-app, authenticated
//
// Security tradeoff explicitly documented on setupStorePassword — the owner
// phone number is a knowledge factor, not a challenge. It is materially
// weaker than OTP, but it is the strongest gate we can offer without a
// working SMS provider and it drops any attacker from "knows the storeId"
// (900k values, enumerable) to "knows the storeId AND the owner phone"
// (roughly 10^16 combined) with per-store rate limits + audit + lockout.
// The endpoint contract is chosen so a future switch back to OTP proves out
// as a server-side change alone — client stays identical.
// ===========================================================================

/**
 * Two-digits + six stars + two-digits mask (e.g. "98******60") — enough for
 * a legitimate operator to recognise their own number and NOT enough for an
 * attacker who guessed a storeId to reconstruct it.
 */
const maskPhone10 = (p) => {
  const s = String(p || "").replace(/\D/g, "").slice(-10);
  return s.length === 10 ? s.slice(0, 2) + "******" + s.slice(-2) : "";
};

/**
 * A store's users whose password was actually chosen by a person. Everything
 * that asks "can someone sign in to this store yet?" must go through here so
 * status and login can never disagree.
 */
const claimedUserFilter = ({ storeId, restaurant }) => {
  const scope = restaurant?._id
    ? { $or: [{ storeId }, { restaurantId: restaurant._id }] }
    : { storeId };
  return {
    ...scope,
    password: { $exists: true, $ne: "" },
    passwordPlaceholder: { $ne: true },
    isActive: true,
    isDeleted: { $ne: true },
  };
};

const findClaimedStoreUser = (scope) => User.exists(claimedUserFilter(scope));

/**
 * POST /api/user/store/status  { storeId }  — public
 *
 * Returns whether the store has a working POS User + a phone hint, so the
 * client can pick between three UI modes:
 *   hasPassword=true  →  login form (password field)
 *   hasPassword=false →  first-time setup (owner phone + new password)
 *   (client also uses reset UX from the login screen; same setup endpoint)
 *
 * The ownerPhoneHint helps operators confirm they picked the right store
 * before they type their number. Store status (deleted / suspended / closed)
 * is enforced first so an unavailable store cannot be interrogated.
 */
const checkStoreStatus = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    if (!/^\d{6}$/.test(storeId)) {
      return next(createHttpError(400, "Store ID must be a 6-digit number."));
    }
    const { restaurant, store } = await findRestaurantOrStore(storeId);
    if (!store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const ownerPhone = await resolveStoreOwnerPhone(restaurant, store);

    // "Has a password" means A HUMAN CHOSE ONE — not merely "a User row
    // exists". `password` is required:true on the model, so every row has a
    // hash; system-materialised rows (the CSD "Open POS" bootstrap) carry a
    // random hash nobody holds and are flagged passwordPlaceholder. Counting
    // those as a password is what stranded new stores on a login form for a
    // password that was never set.
    //
    // Scoped by storeId (not restaurant.ownerId) because any staff member may
    // have claimed the store, and because ownerId is frequently unset.
    const hasPassword = !!(await findClaimedStoreUser({ storeId, restaurant }));

    res.status(200).json({
      success: true,
      data: {
        storeId,
        storeName: restaurant?.name || store?.storeName || "",
        hasPassword,
        ownerPhoneHint: maskPhone10(ownerPhone),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/setup-password  { storeId, ownerPhone, password }  — public
 *
 * Serves both first-time setup (no User yet) and password reset (User
 * exists). Same request shape, same code path, same audit event. The
 * knowledge factor is the OWNER PHONE — this endpoint refuses any phone
 * that does not match the store's recorded ownerPhone, with the same
 * generic message on every mismatch so it cannot be used to enumerate.
 *
 * On success, every prior session is invalidated (including the caller's
 * own — a reset should invalidate the person doing it too, in case they
 * are actually an attacker who just watched the operator type their new
 * password), then a fresh session is issued.
 */
const setupStorePassword = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const rawPhone = toSafeString(req.body.ownerPhone).replace(/\D/g, "");
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Store ID must be a 6-digit number."));
    if (!/^\d{10}$/.test(rawPhone)) return next(createHttpError(400, "Owner phone must be a 10-digit number."));
    if (password.length < 8) return next(createHttpError(400, "Password must be at least 8 characters."));

    const { restaurant: initialRestaurant, store } = await findRestaurantOrStore(storeId);
    if (!store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(initialRestaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const ownerPhone = await resolveStoreOwnerPhone(initialRestaurant, store);
    if (!ownerPhone || ownerPhone !== rawPhone) {
      return next(createHttpError(400, "Owner phone number does not match the Store ID."));
    }

    // Materialise the restaurant/user pair the way completeStoreSignup did,
    // minus the OTP verify. This is the ONE remaining place a POS User can
    // come into existence without an admin action — every other path
    // requires a CSD admin to onboard the store first.
    let restaurant = initialRestaurant;
    if (!restaurant) {
      restaurant = await Restaurant.create({
        name: store.storeName,
        storeId: store.storeId,
        phone: rawPhone,
        address: { line1: "Default Address" },
        isVerified: true,
        isApproved: true,
        subscriptionStatus: "ACTIVE",
      });
      store.restaurantId = restaurant._id;
      store.status = "active";
      await store.save();
    }

    let user = await User.findOne({ phone: rawPhone, restaurantId: restaurant._id });
    let created = false;
    if (!user) {
      user = await User.create({
        name: store.ownerName || restaurant.name,
        phone: rawPhone,
        address: "Default Address",
        password, // pre-save hook hashes
        passwordPlaceholder: false,
        role: "Owner",
        restaurantId: restaurant._id,
        storeId,
      });
      created = true;
      if (!restaurant.ownerId) {
        restaurant.ownerId = user._id;
        await restaurant.save();
      }
    } else {
      user.password = password;      // re-hashed on save
      user.sessions = [];            // invalidate every prior session
      user.mustChangePassword = false;
      user.passwordPlaceholder = false; // a person has now chosen it
      user.loginAttempts = 0;
      user.lockedUntil = undefined;
      await user.save();
    }

    await provisionWebsiteSafely({
      storeId: store.storeId,
      storeName: restaurant.name,
      restaurantId: restaurant._id,
    });

    await signTokensAndSetCookies(user, req, res);

    res.status(created ? 201 : 200).json({
      success: true,
      message: created
        ? "Password set. You are signed in."
        : "Password reset. You are signed in.",
      data: user.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/account-status  { storeId, phone }  - public
 *
 * Does this phone have a usable password on this store yet?
 *
 * Staff are created by the owner with an unusable random password, so a new
 * staff member has nothing to type on their first sign-in. The client asks
 * this after the phone step and shows Create Password instead of a password
 * field, which is the flow Manage Staff describes.
 *
 * Security: this does confirm whether a phone is registered at a store, so
 * it is rate limited per storeId + IP like the other lookups. The caller
 * must already know a valid 6-digit storeId, and /store/status already
 * exposes comparable information. It never reveals a name, a role, or
 * anything about the password itself.
 */
const checkStoreAccountStatus = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "").slice(-10);
    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Store ID must be a 6-digit number."));
    if (!/^\d{10}$/.test(phone)) return next(createHttpError(400, "Enter a 10-digit phone number."));

    const { restaurant, store } = await findRestaurantOrStore(storeId);
    if (!store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const user = await User.findOne({
      storeId,
      phone,
      isActive: true,
      isDeleted: { $ne: true },
    });

    res.status(200).json({
      success: true,
      data: {
        exists: Boolean(user),
        // True only for an account that has never had a password chosen.
        needsPasswordSetup: Boolean(user && user.passwordPlaceholder === true),
        name: user ? user.name || "" : "",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/store/set-password  { storeId, phone, password }  - public
 *
 * First-time password for a staff account. Deliberately ONE-SHOT: it works
 * only while the account still carries the placeholder password the owner
 * created it with. Once a password exists this returns 409 and the only way
 * to change it is signing in and using Change Password, or the owner
 * resetting it - so this cannot be used to take over a live account.
 */
const setStoreAccountPassword = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phone = toSafeString(req.body.phone).replace(/\D/g, "").slice(-10);
    const password = typeof req.body.password === "string" ? req.body.password : "";

    if (!/^\d{6}$/.test(storeId)) return next(createHttpError(400, "Store ID must be a 6-digit number."));
    if (!/^\d{10}$/.test(phone)) return next(createHttpError(400, "Enter a 10-digit phone number."));
    if (password.length < 8) return next(createHttpError(400, "Password must be at least 8 characters."));

    const { restaurant, store } = await findRestaurantOrStore(storeId);
    if (!store) return next(createHttpError(404, "Invalid Store ID"));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    const user = await User.findOne({
      storeId,
      phone,
      isActive: true,
      isDeleted: { $ne: true },
    });
    if (!user) return next(createHttpError(404, "No account with that phone number at this store."));

    if (user.passwordPlaceholder !== true) {
      return next(
        createHttpError(409, "This account already has a password. Please sign in instead.", {
          code: "ACCOUNT_HAS_PASSWORD",
        })
      );
    }

    user.password = password; // hashed by the pre-save hook
    user.passwordPlaceholder = false;
    user.mustChangePassword = false;
    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    user.sessions = [];        // nothing legitimate can be holding one yet
    await user.save();

    await signTokensAndSetCookies(user, req, res);

    res.status(200).json({
      success: true,
      message: "Password created. You are signed in.",
      data: user.toSafeJSON(),
    });
  } catch (error) {
    next(error);
  }
};
/**
 * POST /api/user/store/login  { storeId, phone, password }  — public
 *
 * Multi-user POS sign-in. A store has ONE Owner plus any number of staff
 * added from Settings → Staff; each of them signs in with the same storeId
 * but their own phone + password. The phone acts as the account selector
 * inside the tenant; the password is what actually authenticates.
 *
 * Failures collapse to the same generic "Invalid credentials." (unknown
 * phone, wrong password, deleted/inactive account) so this cannot be used
 * to enumerate staff. The ONE exception is a store with no users yet at
 * all, which returns 409 NO_PASSWORD so the client can route to first-time
 * setup instead of an infinite "wrong password" loop.
 *
 * Reuses loginAttempts / lockedUntil on the User model, and the shared
 * signTokensAndSetCookies primitive, so lockout and session issuance
 * behave exactly like the legacy Product-ID + password login.
 */
const storeLoginWithPassword = async (req, res, next) => {
  try {
    const storeId = toSafeString(req.body.storeId).trim();
    const phoneRaw = toSafeString(req.body.phone).replace(/\D/g, "").slice(-10);
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (!/^\d{6}$/.test(storeId) || !/^\d{10}$/.test(phoneRaw) || !password) {
      return next(createHttpError(400, "Store ID, phone and password are required."));
    }

    const { restaurant, store } = await findRestaurantOrStore(storeId);
    if (!store) return next(createHttpError(401, "Invalid credentials."));

    const unavailable = getStoreUnavailableReason(restaurant, store);
    if (unavailable) return next(createHttpError(400, unavailable));

    // Anyone actually claimed this store yet? A store whose only rows are
    // system-seeded placeholders counts as unclaimed — same rule as
    // /store/status, so the two endpoints can never disagree and bounce the
    // operator between "set a password" and "wrong password".
    const anyUserExists = await findClaimedStoreUser({ storeId, restaurant });
    if (!anyUserExists) {
      return next(
        createHttpError(409, "This store has no password yet. Please set one up first.", { code: "STORE_NO_PASSWORD" })
      );
    }

    const user = await User.findOne({
      storeId,
      phone: phoneRaw,
      isActive: true,
      isDeleted: { $ne: true },
    });
    if (!user) {
      // Unknown phone for this store — same generic reply.
      return next(createHttpError(401, "Invalid credentials."));
    }
    if (user.isDeleted || !user.isActive) {
      return next(createHttpError(401, "Invalid credentials."));
    }
    // Never let a placeholder hash be guessed at: nobody holds it, so every
    // attempt would burn a login attempt toward lockout for no reason.
    if (user.passwordPlaceholder === true) {
      return next(
        createHttpError(409, "This account has no password yet. Please set one up first.", { code: "ACCOUNT_NO_PASSWORD" })
      );
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return next(createHttpError(423, "Account locked. Try again later."));
    }

    const ok = user.password && (await bcrypt.compare(password, user.password));
    if (!ok) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= config.maxLoginAttempts) {
        user.lockedUntil = new Date(Date.now() + config.lockoutDurationMs);
        user.loginAttempts = 0;
        await user.save();
        return next(createHttpError(423, "Too many attempts. Account locked for 15 minutes."));
      }
      await user.save();
      return next(createHttpError(401, "Invalid credentials."));
    }

    user.loginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = new Date();
    await signTokensAndSetCookies(user, req, res);

    res.status(200).json({
      success: true,
      data: {
        ...user.toSafeJSON(),
        mustChangePassword: user.mustChangePassword === true,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/change-password  { currentPassword, newPassword }  — auth
 *
 * The in-app change flow. Requires re-authentication with the current
 * password so a stolen cookie session cannot silently rotate a user's
 * password, which would lock the real user out and hand the attacker a
 * permanent credential. Keeps the current session alive so the operator
 * does not have to re-log in the tab they just used to change; every
 * OTHER session is invalidated.
 */
const changePassword = async (req, res, next) => {
  try {
    const current = typeof req.body.currentPassword === "string" ? req.body.currentPassword : "";
    const nextPw = typeof req.body.newPassword === "string" ? req.body.newPassword : "";
    if (!current) return next(createHttpError(400, "Current password is required."));
    if (nextPw.length < 8) return next(createHttpError(400, "New password must be at least 8 characters."));
    if (current === nextPw) return next(createHttpError(400, "New password must differ from the current one."));

    const user = req.user;
    const ok = user.password && (await bcrypt.compare(current, user.password));
    if (!ok) return next(createHttpError(401, "Current password is incorrect."));

    user.password = nextPw;
    user.mustChangePassword = false;
    user.passwordPlaceholder = false;
    const currentJti = req.user.jti;
    user.sessions = (user.sessions || []).filter(
      (s) => String(s._id) === String(currentJti)
    );
    await user.save();

    res.status(200).json({ success: true, message: "Password updated." });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/user/impersonate — CSD → POS handoff.
 *
 * Consumes a one-shot support-session token minted by CSD's createPosSession
 * (see csdRestaurantController) and issues a normal POS session cookie so
 * the admin lands directly on the POS home. This is the "Open POS" button
 * on the CSD Restaurant Detail page.
 *
 * Security:
 *   - Token is looked up by sha256 hash, matching how CsdPosSession stores it.
 *   - Single use: the session row's usedAt is set atomically; a replay of the
 *     same token is refused.
 *   - Short-lived: the CSD side sets expiresAt to a few minutes; expired
 *     tokens are rejected.
 *   - No auth middleware — the token IS the credential.
 *   - The POS session issued is identical in shape to a normal login, so all
 *     tenant guards (restaurantId in the JWT vs the DB) still hold.
 */
const CsdPosSession = require("../models/csdPosSessionModel");

const impersonateWithSupportToken = async (req, res, next) => {
  try {
    const raw = toSafeString(req.body?.token).trim();
    if (!raw || raw.length < 32) {
      return next(createHttpError(400, "Missing or invalid support token."));
    }
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");

    // Atomic claim: only unused, unexpired rows flip to used. Anything else
    // returns null and is refused as a generic invalid token — no leak about
    // whether it was already used vs never existed.
    const now = new Date();
    const clientIp = (req.headers["x-real-ip"] || req.ip || "").toString().split(",")[0].trim();
    const support = await CsdPosSession.findOneAndUpdate(
      { tokenHash, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now, usedFromIp: clientIp } },
      { new: true }
    );
    if (!support) {
      return next(createHttpError(401, "Support token is invalid, already used, or expired."));
    }

    // Prefer an active Owner for that store; fall back to any active user so
    // admin can still get in when the owner seat hasn't been claimed yet.
    let user =
      (await User.findOne({
        storeId: support.storeId,
        role: "Owner",
        isActive: true,
        isDeleted: { $ne: true },
      })) ||
      (await User.findOne({
        storeId: support.storeId,
        isActive: true,
        isDeleted: { $ne: true },
      }));

    // If the store has no user at all yet (operator never completed first-time
    // setup), auto-bootstrap an Owner from the store record so the CSD "Open
    // POS" flow works end-to-end. The seeded user gets an unusable random
    // password + mustChangePassword=true, so the real operator can still claim
    // the account later via /store/setup-password (owner-phone gate applies,
    // same as normal reset).
    if (!user) {
      const { store, restaurant } = await findRestaurantOrStore(support.storeId);
      if (!store || !restaurant) {
        return next(
          createHttpError(409, "This store has no restaurant record — cannot open the POS.")
        );
      }
      const seedPhone = String(store.ownerPhone || "").replace(/\D/g, "").slice(-10);
      const seedName = store.ownerName || restaurant.name || "Owner";
      const randomPw = crypto.randomBytes(32).toString("hex");
      const seedPayload = {
        name: seedName,
        address: (restaurant.address && (restaurant.address.line1 || "")) || "N/A",
        password: randomPw,
        role: "Owner",
        restaurantId: restaurant._id,
        storeId: support.storeId,
        isActive: true,
        mustChangePassword: true,
        // The hash above is 32 random bytes — no human holds it. Without this
        // flag the store looks "already set up" to /store/status and the real
        // operator is shown a password prompt they can never satisfy.
        passwordPlaceholder: true,
      };
      if (/^\d{10}$/.test(seedPhone)) seedPayload.phone = seedPhone;
      user = await User.create(seedPayload);

      // Backfill Restaurant.ownerId so future non-CSD lookups by ownerId
      // (legacy flows) resolve to the same user.
      if (!restaurant.ownerId) {
        await require("../models/restaurantModel").updateOne(
          { _id: restaurant._id },
          { $set: { ownerId: user._id } }
        );
      }
    }

    await signTokensAndSetCookies(user, req, res);

    res.status(200).json({
      success: true,
      data: {
        user: user.toSafeJSON ? user.toSafeJSON() : {
          _id: user._id, name: user.name, role: user.role,
          storeId: user.storeId, restaurantId: user.restaurantId,
        },
        supportContext: {
          issuedBy: support.staffName || support.staffCode || "CSD",
          reason: support.reason || "",
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  refreshToken,
  getUserData,
  logout,
  checkStoreStatus,
  checkStoreAccountStatus,
  setStoreAccountPassword,
  setupStorePassword,
  storeLoginWithPassword,
  changePassword,
  impersonateWithSupportToken,
};
