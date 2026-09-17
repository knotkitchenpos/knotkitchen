/**
 * Menu cache — which copy of a menu each audience is allowed to see.
 *
 * A Menu document carries three copies of its catalogue:
 *
 *   menu.items            the DRAFT. Everything Manage Menu writes — CSV
 *                         imports, price edits, images, new categories and
 *                         products — lands here. Only Manage Menu reads it.
 *   menu.systemSnapshot   what the POS tills serve.
 *   menu.websiteSnapshot  what the customer website serves.
 *
 * Both snapshots are written together by one action: "Publish System" in
 * Settings › Manage Cache. Nothing an operator or a support member saves in
 * Manage Menu reaches a till or the website until someone presses it.
 *
 * A till is mid-service. Repricing a dish under a cashier who has already
 * quoted it, or making a category appear halfway through a shift, is how a
 * customer gets charged something other than what they were told. So the till
 * serves a frozen copy and the operator decides when to swap it. The website
 * follows the same rule so what a customer is shown never changes under a
 * half-edited menu.
 *
 * A menu that has never been published to the website serves its draft. The
 * gate applies from the first publish; stores that predate it do not go blank.
 */

const AUDIENCES = Object.freeze({
  DRAFT: "draft",
  SYSTEM: "system",
  WEBSITE: "website",
});

/**
 * The name + items a given audience should see for one menu.
 * Never mutates the document.
 *
 * @param {object} menu      a Menu document or plain object
 * @param {string} audience  one of AUDIENCES
 * @returns {{name: string, items: Array, isPublished: boolean}}
 */
const menuViewFor = (menu, audience) => {
  if (!menu) return { name: "", items: [], isPublished: false };

  if (audience === AUDIENCES.SYSTEM) {
    const snap = menu.systemSnapshot;
    const published = Boolean(menu.hasPublishedToSystem && snap);
    return {
      name: (published && snap.name) || menu.name,
      items: published ? snap.items || [] : [],
      isPublished: published,
    };
  }

  if (audience === AUDIENCES.WEBSITE) {
    const snap = menu.websiteSnapshot;
    const published = Boolean(menu.hasPublishedToWebsite && snap);
    if (published) return { name: snap.name || menu.name, items: snap.items || [], isPublished: true };
  }

  // Draft, or a website that has never been published: what Manage Menu holds
  // right now. Category visibility still applies on top (see
  // WEBSITE_VISIBLE_QUERY), so hiding a category still hides it.
  return { name: menu.name, items: menu.items || [], isPublished: true };
};

/**
 * A plain copy of `menu` whose `name` and `items` are the audience's view.
 *
 * Returning the same shape the callers already expect means every consumer
 * downstream — pricing, availability, the storefront serialiser — keeps
 * reading `menu.items` and automatically operates on the published copy.
 * That is what keeps the price a customer is charged equal to the price they
 * were shown: both now come from the same snapshot.
 */
const toPlainItem = (item) =>
  item && typeof item.toObject === "function" ? item.toObject() : item;

const projectMenu = (menu, audience) => {
  const plain = menu && typeof menu.toObject === "function" ? menu.toObject() : { ...(menu || {}) };
  const view = menuViewFor(menu, audience);
  plain.name = view.name;
  // Normalise to plain objects for EVERY audience. The snapshot arrays are
  // Mongoose subdocuments while a toObject()'d draft is not, and callers that
  // spread items (`{ ...item }`) behave differently for the two. One shape
  // keeps every downstream consumer honest.
  plain.items = (view.items || []).map(toPlainItem);
  return plain;
};

/**
 * Project a list of menus, dropping the ones with nothing published for this
 * audience. Draft callers get everything, untouched in spirit.
 */
const projectMenus = (menus, audience) => {
  const list = Array.isArray(menus) ? menus : [];
  if (audience === AUDIENCES.DRAFT) return list.map((m) => projectMenu(m, audience));
  return list
    .map((m) => projectMenu(m, audience))
    .filter((m) => Array.isArray(m.items) && m.items.length > 0);
};

/**
 * True when the draft has moved on from what a target is serving.
 * Used to tell the operator they have something worth publishing.
 */
const hasUnpublishedChanges = (menu, audience) => {
  if (!menu) return false;
  if (audience === AUDIENCES.DRAFT) return false;
  const web = audience === AUDIENCES.WEBSITE;
  const stamp = web ? menu.lastPublishedToWebsiteAt : menu.lastPublishedToSystemAt;
  const publishedFlag = web ? menu.hasPublishedToWebsite : menu.hasPublishedToSystem;
  if (!publishedFlag || !stamp) return true;
  const changedAt = menu.updatedAt;
  if (!changedAt) return false;
  return new Date(changedAt).getTime() > new Date(stamp).getTime();
};

/**
 * Per-surface category visibility.
 *
 * `published` (Display Status) is the master switch: ON shows the category on
 * both the POS and the website. When it is OFF the two per-surface flags take
 * over, so a category can be hidden everywhere except one surface. Both
 * default to false, so "Display OFF" keeps meaning "hidden from both" for
 * every category that predates them.
 */
const isVisibleOnPos = (menu) => (menu ? menu.published !== false || menu.showOnPos === true : false);
const isVisibleOnWebsite = (menu) => (menu ? menu.published !== false || menu.showOnWebsite === true : false);

/** Mongo clauses matching the two rules above, for use in a find(). */
const POS_VISIBLE_QUERY = { $or: [{ published: { $ne: false } }, { showOnPos: true }] };
const WEBSITE_VISIBLE_QUERY = { $or: [{ published: { $ne: false } }, { showOnWebsite: true }] };

/**
 * Order types a category may be sold through.
 *
 * dispatchType has existed on the model since the beginning but was stored and
 * never read — every surface showed every category regardless. Enabling only
 * "Collection" now genuinely restricts the category to collection orders.
 *
 * An absent or empty dispatchType means "no restriction", which keeps every
 * category created before this behaved as it always did.
 */
const ORDER_TYPES = Object.freeze({ COLLECTION: "collection", DELIVERY: "delivery", TABLE: "table" });

const allowsOrderType = (menu, orderType) => {
  if (!menu || !orderType) return true;
  const dt = menu.dispatchType;
  if (!dt) return true;
  const flags = typeof dt.toObject === "function" ? dt.toObject() : dt;
  const { collection, delivery, table } = flags || {};
  // All three off (or all undefined) is not a meaningful restriction — treat
  // it as unrestricted rather than silently hiding the category everywhere.
  if (!collection && !delivery && !table) return true;
  if (orderType === ORDER_TYPES.COLLECTION) return collection !== false;
  if (orderType === ORDER_TYPES.DELIVERY) return delivery !== false;
  if (orderType === ORDER_TYPES.TABLE) return table !== false;
  return true;
};

/**
 * How to say a category's dispatch restriction to a customer.
 *
 * Returns null when there is no restriction worth mentioning -- all three
 * order types allowed, or none set (which allowsOrderType treats as
 * unrestricted). Otherwise a label the storefront can print next to the
 * category name, on the product card and in the basket:
 *
 *     "Collection Only"   "Delivery Only"   "Table Orders Only"
 *     "Collection & Delivery Only"
 *
 * customer-web carries its own copy of this (it cannot import from the
 * backend). If the wording changes here, change it there too -- the checkout
 * refusal and the label the customer read while browsing must agree.
 */
const DISPATCH_LABELS = { collection: "Collection", delivery: "Delivery", table: "Table Orders" };

const dispatchLabel = (dispatchType) => {
  if (!dispatchType) return null;
  const dt = typeof dispatchType.toObject === "function" ? dispatchType.toObject() : dispatchType;
  const allowed = ["collection", "delivery", "table"].filter((k) => dt[k] !== false);
  // All three, or none at all, is not a restriction -- see allowsOrderType.
  if (allowed.length === 3 || allowed.length === 0) return null;
  const names = allowed.map((k) => DISPATCH_LABELS[k]);
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  return `${joined} Only`;
};

module.exports = {
  AUDIENCES,
  ORDER_TYPES,
  isVisibleOnPos,
  isVisibleOnWebsite,
  POS_VISIBLE_QUERY,
  WEBSITE_VISIBLE_QUERY,
  allowsOrderType,
  dispatchLabel,
  menuViewFor,
  projectMenu,
  projectMenus,
  hasUnpublishedChanges,
};
