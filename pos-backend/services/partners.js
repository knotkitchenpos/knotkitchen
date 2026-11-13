const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const createHttpError = require("http-errors");
const config = require("../config/config");
const User = require("../models/userModel");
const Restaurant = require("../models/restaurantModel");
const Order = require("../models/orderModel");
const { PartnerAccount, PartnerLink } = require("../models/partnerModel");
const { BusinessBalance } = require("../models/businessBalanceModel");
const { PlatformSubscription } = require("../models/platformSubscriptionModel");
const { asAmount } = require("./money");

/**
 * Partners dashboard sessions and store links (knotkitchen.com/partners).
 *
 * The session is its own cookie on knotkitchen.com under /partners, never one
 * of the POS's: Caddy forwards knotkitchen.com/partners/api/* to
 * /api/partners/* only, so it is first-party and same-origin. Its token is
 * signed with a key of its own, so a POS token can never pass for it or the
 * other way round, and it names a session row that signing out revokes.
 */

const COOKIE = "kk_partner";
const COOKIE_PATH = "/partners";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;
const secret = () => `${config.accessTokenSecret}:partners`;

/** Only a store's Owner login may sign in or link a store. */
const OWNER_ROLE = "Owner";
const isOwnerLogin = (user) => String(user?.role || "") === OWNER_ROLE;

/** A hash of the password hash: changes whenever the store owner's password does. */
const fingerprintOf = (user) => crypto.createHash("sha256").update(`partner-link:${String(user?.password || "")}`).digest("hex");

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.cookieSecure,
  // First-party on knotkitchen.com: never needs to travel cross-site.
  sameSite: "lax",
  path: COOKIE_PATH,
  maxAge: SESSION_MS,
});

/** Start a session for `partner`; sets the cookie. */
const startSession = async (partner, req, res) => {
  const expiresAt = new Date(Date.now() + SESSION_MS);
  partner.sessions.push({
    expiresAt,
    ip: String(req.ip || "").slice(0, 64),
    userAgent: String(req.get?.("user-agent") || "").slice(0, 300),
  });
  // Oldest out first; revoked and expired ones go before any live one.
  const now = new Date();
  partner.sessions = partner.sessions
    .filter((s) => !s.revokedAt && s.expiresAt > now)
    .slice(-MAX_SESSIONS);
  await partner.save();
  const session = partner.sessions[partner.sessions.length - 1];
  const token = jwt.sign({ typ: "partner", pid: String(partner._id), sid: String(session._id) }, secret(), {
    algorithm: "HS256",
    expiresIn: Math.floor(SESSION_MS / 1000),
  });
  res.cookie(COOKIE, token, cookieOptions());
  return session;
};

const clearCookie = (res) => res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });

/** The signed-in partner, or null. Revoked or expired sessions are no session. */
const readSession = async (req) => {
  const token = req.cookies?.[COOKIE];
  if (!token || typeof token !== "string") return null;
  let claims;
  try {
    claims = jwt.verify(token, secret(), { algorithms: ["HS256"] });
  } catch {
    return null;
  }
  if (claims?.typ !== "partner" || !claims.pid || !claims.sid) return null;
  const partner = await PartnerAccount.findById(claims.pid);
  if (!partner) return null;
  const session = partner.sessions.id(claims.sid);
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  // Last seen, at most once a minute (one write, not one per request).
  if (!session.lastActiveAt || Date.now() - new Date(session.lastActiveAt).getTime() > 60_000) {
    session.lastActiveAt = new Date();
    await partner.save().catch(() => {});
  }
  return { partner, session };
};

/** Express guard for every /api/partners route but sign-in. */
const requirePartner = async (req, res, next) => {
  try {
    const found = await readSession(req);
    if (!found) return next(createHttpError(401, "Please sign in to the Partners dashboard.", { code: "PARTNER_SIGNED_OUT" }));
    req.partner = found.partner;
    req.partnerSession = found.session;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * The store owner a link acts as, still valid: active, still the Owner, still
 * this store, password unchanged since the link. Throws with a code the
 * dashboard turns into the right message.
 */
const ownerForLink = async (link) => {
  const user = await User.findById(link.userId);
  if (!user || user.isDeleted || !user.isActive || String(user.storeId || "") !== String(link.storeId)) {
    throw createHttpError(409, "This store's owner login no longer exists. Unlink it, then link it again.", { code: "LINK_INVALID" });
  }
  if (!isOwnerLogin(user)) {
    throw createHttpError(409, "The login this store was linked with is no longer its Owner. Link it again.", { code: "LINK_INVALID" });
  }
  if (fingerprintOf(user) !== link.fingerprint) {
    throw createHttpError(409, "This store's password was changed. Enter the new password to keep it linked.", { code: "LINK_RELINK" });
  }
  return user;
};

/** The partner's link for `storeId`, or a 404 (a store not linked to them is invisible). */
const linkFor = async (partner, storeId) => {
  const id = String(storeId || "");
  if (!/^\d{6}$/.test(id)) throw createHttpError(404, "Store not found.");
  const link = await PartnerLink.findOne({ partnerId: partner._id, storeId: id });
  if (!link) throw createHttpError(404, "Store not found.");
  return link;
};

/** One card per linked store: who, how it is doing, what it owes. */
const storeCards = async (partner) => {
  const links = await PartnerLink.find({ partnerId: partner._id }).sort({ linkedAt: 1 }).lean();
  if (!links.length) return [];
  const restaurantIds = links.map((l) => l.restaurantId);
  const [restaurants, balances, subs, users, lastOrders] = await Promise.all([
    Restaurant.find({ _id: { $in: restaurantIds } }).select("name city branding.logo").lean(),
    BusinessBalance.find({ restaurantId: { $in: restaurantIds } }).select("restaurantId balancePaise lockedAt lockedReason").lean(),
    PlatformSubscription.find({ restaurantId: { $in: restaurantIds } }).select("restaurantId planName planCode status currentPeriodEnd").lean(),
    User.find({ _id: { $in: links.map((l) => l.userId) } }).select("password role isActive isDeleted storeId name").lean(),
    Order.aggregate([
      { $match: { restaurantId: { $in: restaurantIds }, isDeleted: { $ne: true } } },
      { $group: { _id: "$restaurantId", at: { $max: "$createdAt" } } },
    ]),
  ]);
  const by = (list, key = "restaurantId") => new Map(list.map((x) => [String(x[key]), x]));
  const rById = by(restaurants, "_id");
  const bById = by(balances);
  const sById = by(subs);
  const uById = by(users, "_id");
  const oById = by(lastOrders, "_id");
  return links.map((l) => {
    const rid = String(l.restaurantId);
    const r = rById.get(rid) || {};
    const b = bById.get(rid);
    const s = sById.get(rid);
    const u = uById.get(String(l.userId));
    let linkStatus = "ok";
    if (!u || u.isDeleted || !u.isActive || !isOwnerLogin(u) || String(u.storeId || "") !== l.storeId) linkStatus = "invalid";
    else if (fingerprintOf(u) !== l.fingerprint) linkStatus = "relink";
    return {
      storeId: l.storeId,
      restaurantId: rid,
      name: r.name || `Store ${l.storeId}`,
      city: r.city || "",
      logo: r.branding?.logo || "",
      linkedAt: l.linkedAt,
      linkStatus,
      wallet: asAmount(b?.balancePaise || 0),
      locked: Boolean(b?.lockedAt),
      lockedReason: b?.lockedReason || "",
      plan: s ? { name: s.planName || s.planCode || "", status: s.status, renewsOn: s.currentPeriodEnd } : null,
      lastOrderAt: oById.get(rid)?.at || null,
    };
  });
};

module.exports = {
  COOKIE,
  COOKIE_PATH,
  OWNER_ROLE,
  isOwnerLogin,
  fingerprintOf,
  startSession,
  clearCookie,
  readSession,
  requirePartner,
  ownerForLink,
  linkFor,
  storeCards,
};
