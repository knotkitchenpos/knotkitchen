/**
 * Menu cache — which copy of a menu each audience is allowed to see.
 *
 * A Menu document carries three copies of its catalogue:
 *
 *   menu.items            the DRAFT. Everything Manage Menu writes — CSV
 *                         imports, price edits, images, new categories and
 *                         products — lands here and nowhere else.
 *   menu.systemSnapshot   what the POS tills serve. Written only by
 *                         "Update System Cache".
 *   menu.websiteSnapshot  what the customer website serves. Written only by
 *                         "Update Website Cache".
 *
 * Settings → Manage Cache tells the operator, in as many words, that "menu
 * changes do NOT automatically appear in either published environment". That
 * was only half true: every read path fell back to the draft whenever a menu
 * had not been published to that target yet, so a newly created category — or
 * any menu on a store that had never pressed Publish — went straight to the
 * tills and the public site. This module removes the guesswork by making the
 * snapshot the ONLY source for a published audience.
 *
 * The deliberate consequence: a menu that has never been published to a target
 * is invisible to that target. That is the point of a publish step. Migration
 * 003 backfills both snapshots for every pre-existing menu so nothing
 * disappears when this ships.
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
    return {
      name: (published && snap.name) || menu.name,
      items: published ? snap.items || [] : [],
      isPublished: published,
    };
  }

  // Draft — Manage Menu, and nothing else.
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
  const stamp =
    audience === AUDIENCES.SYSTEM ? menu.lastPublishedToSystemAt : menu.lastPublishedToWebsiteAt;
  const publishedFlag =
    audience === AUDIENCES.SYSTEM ? menu.hasPublishedToSystem : menu.hasPublishedToWebsite;
  if (!publishedFlag || !stamp) return true;
  const changedAt = menu.updatedAt;
  if (!changedAt) return false;
  return new Date(changedAt).getTime() > new Date(stamp).getTime();
};

module.exports = {
  AUDIENCES,
  menuViewFor,
  projectMenu,
  projectMenus,
  hasUnpublishedChanges,
};
