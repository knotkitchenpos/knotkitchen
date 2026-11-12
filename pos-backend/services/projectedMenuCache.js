/**
 * Projected menus, remembered until a menu changes.
 *
 * Building a customer-facing menu means loading every full Menu document
 * (live draft plus both published snapshots) and projecting it. For a real
 * store that was ~100 ms of CPU per request, and it is the request the public
 * menu, the storefront, Knot Eats and table QR make most (load test,
 * 2026-11-12: the API saturated one core at ~50 requests a second).
 *
 * Every call still asks the database which menus exist and when each last
 * changed (a ~2 ms indexed read of _id/updatedAt/__v). Only when that answer
 * is exactly the one the cached projection was built from is the cached copy
 * used, so a saved edit shows on the very next request, in every process.
 * Every Menu write goes through Mongoose with timestamps on, so any change
 * moves updatedAt.
 *
 * Callers get their own copy: some edit what they are given (table QR prices
 * each item, scopedMenu deletes the snapshots), and none may change the copy
 * kept here.
 *
 * Not used for checkout or order pricing: those keep reading menus directly.
 */
const { projectMenus } = require("./menuCache");

const MAX_ENTRIES = Number(process.env.MENU_PROJECTION_CACHE_MAX) || 300;
const cache = new Map(); // key -> { mark, menus }

// Copies arrays and plain objects; everything else (ObjectId, Date, Buffer)
// is kept by reference, which is what toObject() output holds.
const copy = (v) => {
  if (Array.isArray(v)) return v.map(copy);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = copy(v[k]);
    return o;
  }
  return v;
};

// null when any menu has no updatedAt: then a change could not be seen, so
// nothing is cached for that store.
const markOf = (rows) => {
  if (!Array.isArray(rows) || rows.some((m) => !m || !m.updatedAt)) return null;
  return rows.map((m) => `${m._id}:${new Date(m.updatedAt).getTime()}:${m.__v ?? 0}`).join(",");
};

// Runs a Menu.find() with optional sort/lean, tolerating a stand-in model
// whose find() resolves straight to an array.
const run = async (q, { sort, lean } = {}) => {
  if (sort && q && typeof q.sort === "function") q = q.sort(sort);
  if (lean && q && typeof q.lean === "function") q = q.lean();
  return (await q) || [];
};

/**
 * @param {object} args
 *   Menu     the caller's Menu model (each caller passes its own import, so
 *            a test that stands one in for that caller still reaches it)
 *   query    Menu filter (must include the tenant: restaurantId)
 *   audience AUDIENCES.WEBSITE | AUDIENCES.SYSTEM
 *   sort     optional Mongoose sort, e.g. { createdAt: 1 }
 * @returns {Promise<Array>} projected menus, a copy the caller may change
 */
const projectedMenus = async ({ Menu, query, audience, sort }) => {
  const key = JSON.stringify([audience, query, sort || null]);

  const hit = cache.get(key);
  if (hit) {
    const mark = markOf(await run(Menu.find(query, { _id: 1, updatedAt: 1, __v: 1 }), { sort, lean: true }));
    if (mark !== null && hit.mark === mark) {
      cache.delete(key); // most recently used goes last
      cache.set(key, hit);
      return copy(hit.menus);
    }
  }

  const docs = await run(Menu.find(query), { sort });
  const menus = projectMenus(docs, audience);

  // Keyed on what was actually loaded: a save between the two reads must not
  // be remembered under the older mark.
  cache.delete(key);
  const mark = markOf(docs);
  if (mark !== null) {
    cache.set(key, { mark, menus: copy(menus) });
    if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  }
  return menus;
};

const clearProjectedMenuCache = () => cache.clear();

module.exports = { projectedMenus, clearProjectedMenuCache };
