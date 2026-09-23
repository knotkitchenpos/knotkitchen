const mongoose = require("mongoose");

/**
 * Really delete a store.
 *
 * "Permanently delete" only ever flipped `isDeleted` on the Store and the
 * Restaurant. Every other record a store owns -- its orders, staff, tables,
 * menus, sessions, QR codes, website settings, agreements -- was left in the
 * database untouched, so the store kept working through any route that did
 * not happen to check those two flags, and none of its data was actually
 * gone.
 *
 * The sweep is GENERIC rather than a hand-written list of collections: it
 * walks the registered models and deletes from any that carries a
 * `restaurantId` or a `storeId`. A hand-written list is exactly the kind that
 * goes stale -- somebody adds a model, nobody adds it here, and a "permanent"
 * delete quietly leaves data behind again.
 *
 * KEEP is the deliberate opposite: records that must survive the store.
 */

/**
 * What a deletion does NOT remove, and why.
 *
 *   AuditLog / CsdAuditLog   the record OF the deletion lives here. Erasing
 *                            the audit trail as part of an audited action is
 *                            self-defeating.
 *
 *   PlatformInvoice          KnotKitchen's own invoices to the restaurant.
 *                            These are our accounting records, not the
 *                            store's data, and they are kept for the same
 *                            reason any business keeps issued invoices.
 *
 *   BusinessBalanceLedger    the money movements behind those invoices.
 *
 *   ProductId                the hardware/product registration, which is
 *                            reassigned to a new store rather than destroyed.
 */
const KEEP = new Set([
  "AuditLog",
  "CsdAuditLog",
  "PlatformInvoice",
  "BusinessBalanceLedger",
  "ProductId",
]);

const LEGACY_COLLECTIONS = ["outlets", "teams", "subscriptions", "invoices", "subscriptionpayments"];

/** The Store and Restaurant rows themselves are removed by the caller, last. */
const HANDLED_BY_CALLER = new Set(["Store", "Restaurant"]);

const scopeFilterFor = (Model, { restaurantId, storeId }) => {
  const paths = Model.schema.paths;
  const or = [];
  if (restaurantId && paths.restaurantId) or.push({ restaurantId });
  if (storeId && paths.storeId) or.push({ storeId });
  // Some collections key only by the store's own id under a different name.
  if (storeId && paths.store) or.push({ store: storeId });
  if (!or.length) return null;
  return or.length === 1 ? or[0] : { $or: or };
};

/**
 * Delete every document belonging to this store.
 *
 * Returns a per-collection count so the audit entry records exactly what was
 * destroyed -- a permanent delete that cannot say what it removed is not one
 * anybody should trust.
 */
const purgeStoreData = async ({ restaurantId, storeId }) => {
  if (!restaurantId && !storeId) {
    throw new Error("purgeStoreData needs a restaurantId or a storeId.");
  }

  const deleted = {};
  const skipped = [];

  for (const [name, Model] of Object.entries(mongoose.models)) {
    if (KEEP.has(name) || HANDLED_BY_CALLER.has(name)) {
      skipped.push(name);
      continue;
    }
    const filter = scopeFilterFor(Model, { restaurantId, storeId });
    if (!filter) continue;

    try {
      const res = await Model.deleteMany(filter);
      if (res?.deletedCount) deleted[name] = res.deletedCount;
    } catch (err) {
      // One collection failing must not strand the rest half-deleted with no
      // record of which. Collected and surfaced to the audit entry.
      deleted[`${name}:ERROR`] = err.message;
    }
  }

  // Collections whose models were removed with the old onboard/team/billing
  // prototype. Nothing writes them any more and the walk above cannot see
  // them, but a purged store must not leave rows behind there either.
  if (restaurantId && mongoose.isValidObjectId(restaurantId) && mongoose.connection.readyState === 1) {
    const rid = new mongoose.Types.ObjectId(String(restaurantId));
    for (const name of LEGACY_COLLECTIONS) {
      try {
        const res = await mongoose.connection.collection(name).deleteMany({ restaurantId: rid });
        if (res?.deletedCount) deleted[name] = res.deletedCount;
      } catch (err) {
        deleted[`${name}:ERROR`] = err.message;
      }
    }
  }

  return { deleted, skipped };
};

module.exports = { purgeStoreData, KEEP, HANDLED_BY_CALLER };
