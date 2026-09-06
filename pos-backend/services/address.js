/**
 * One way to turn a stored address into a line of text.
 *
 * `Restaurant.address` is a Mongoose SUBDOCUMENT, not a string. Interpolating
 * one into a template does not give you "[object Object]" -- Mongoose
 * documents carry their own toString(), so it renders as the inspected object:
 *
 *     { line1: 'Demo Address', line2: '', city: 'Kolkata', state: 'West
 *       Bengal', postalCode: '700094', country: 'India' }
 *
 * which is what customers were being shown on their bill.
 *
 * There were also several hand-rolled joins around the codebase, each picking
 * a different subset of the fields, so one restaurant's address appeared three
 * different ways depending on which screen printed it. This is the only one.
 *
 * `country` is left out by default: every line of a domestic bill saying
 * "India" is noise, and both existing callers already omitted it.
 */

const PARTS = ["line1", "line2", "city", "state", "postalCode"];

const formatAddress = (address, { includeCountry = false } = {}) => {
  if (!address) return "";

  // Accept a plain object, a Mongoose subdocument, or an already-formatted
  // string -- callers reach this from all three directions.
  if (typeof address === "string") return address.trim();

  const source = typeof address.toObject === "function" ? address.toObject() : address;
  const keys = includeCountry ? [...PARTS, "country"] : PARTS;

  return keys
    .map((key) => String(source[key] === null || source[key] === undefined ? "" : source[key]).trim())
    .filter(Boolean)
    .join(", ");
};

module.exports = { formatAddress, ADDRESS_PARTS: PARTS };
