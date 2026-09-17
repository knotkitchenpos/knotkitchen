const Store = require("../models/storeModel");
const Restaurant = require("../models/restaurantModel");

/**
 * Resolve the authenticated caller's tenant (§15).
 *
 * The storeId is ALWAYS derived from the authenticated user — never from the
 * request body, query string or headers. Callers use this so a compromised or
 * malicious client cannot address another tenant's data by sending a different
 * storeId.
 *
 * Lookup chain (users are created through several historical flows):
 *   1. user.storeId            — set by store signup
 *   2. restaurant.storeId      — set by admin portal store creation
 *   3. Store.findOne({ restaurantId }) — legacy records
 */
const resolveTenantFromUser = async (user) => {
  if (!user) return { storeId: null, restaurantId: null, outletId: null };

  const restaurantId = user.restaurantId || null;
  const outletId = user.outletId || null;

  if (user.storeId) {
    return { storeId: String(user.storeId), restaurantId, outletId };
  }

  if (restaurantId) {
    const restaurant = await Restaurant.findById(restaurantId).select("storeId timezone currency");
    if (restaurant?.storeId) {
      return { storeId: String(restaurant.storeId), restaurantId, outletId, restaurant };
    }

    const store = await Store.findOne({ restaurantId, isDeleted: { $ne: true } }).select("storeId");
    if (store?.storeId) {
      return { storeId: String(store.storeId), restaurantId, outletId };
    }
  }

  return { storeId: null, restaurantId, outletId };
};

/**
 * Build a Mongo filter that constrains a query to the caller's tenant.
 * Used by the media library so every read/write is scoped by construction.
 */
const tenantFilter = ({ storeId, restaurantId }) => {
  const or = [];
  if (storeId) or.push({ storeId: String(storeId) });
  if (restaurantId) or.push({ restaurantId });
  if (!or.length) return null; // no tenant => caller gets nothing
  return or.length === 1 ? or[0] : { $or: or };
};

/**
 * The Mongo filter for "this user's own data" on restaurant-keyed
 * collections (Menu, TableSession, Order): the restaurant when the user
 * belongs to one, else what they created. Deliberately no outletId: the
 * menu is shared by every outlet of a restaurant (see menuController).
 */
const userScope = (user) => {
  if (user?.restaurantId) return { restaurantId: user.restaurantId };
  return { createdBy: user?._id };
};

module.exports = { resolveTenantFromUser, tenantFilter, userScope };
