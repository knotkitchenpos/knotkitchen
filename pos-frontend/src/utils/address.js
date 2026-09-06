/**
 * One way to turn a stored address into a line of text.
 *
 * There were three hand-rolled joins of this — on the POS invoice, the Orders
 * screen and Reports — and each picked a different subset of the fields, so one
 * restaurant's address appeared three different ways depending on which screen
 * printed it. The invoice dropped the state, Orders dropped line2 AND the
 * state, Reports kept both.
 *
 * Mirrors `pos-backend/services/address.js`, which is where the same address
 * gets flattened for the e-bill and the public receipt page. Keep them in step.
 */

const PARTS = ["line1", "line2", "city", "state", "postalCode"];

const join = (values) =>
  values
    .map((v) => String(v === null || v === undefined ? "" : v).trim())
    .filter(Boolean)
    .join(", ");

/** Flatten a `Restaurant.address` object. Returns "" when there is nothing to show. */
export const formatAddress = (address, { includeCountry = false } = {}) => {
  if (!address) return "";
  if (typeof address === "string") return address.trim();
  const keys = includeCountry ? [...PARTS, "country"] : PARTS;
  return join(keys.map((key) => address[key]));
};

/** The website editor stores its own contact address under different key names. */
export const formatWebsiteContactAddress = (contact) => {
  if (!contact) return "";
  if (typeof contact.address === "string" && contact.address.trim()) return contact.address.trim();
  return join([contact.addressLine1, contact.addressLine2, contact.city, contact.postalCode]);
};

/**
 * The address to print on a receipt or report, in preference order:
 * the store profile's own full address, then the restaurant record, then
 * whatever the website editor was given.
 */
export const receiptAddress = ({ storeProps, restaurant, websiteSettings } = {}) =>
  (storeProps && storeProps.fullAddress && String(storeProps.fullAddress).trim()) ||
  formatAddress(restaurant && restaurant.address) ||
  formatWebsiteContactAddress(websiteSettings && websiteSettings.contact) ||
  "";

export default formatAddress;
