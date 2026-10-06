/**
 * Phone helpers. The OTP flow that used to live here was retired with the
 * 2026-08-31 move to password sign-in; only the helpers other code imports
 * remain.
 */

const normalizePhone = (phone) => String(phone || "").replace(/\D/g, "").slice(-10);

/**
 * Mask a phone number for logs / responses so an attacker inspecting responses
 * cannot enumerate registered owners.
 */
const maskPhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
};

/** A 10-digit Indian mobile from "+91 98300 12345", "098300…" and the like, or "" when it is not one. */
const indianMobile = (raw) => {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : "";
};

module.exports = {
  normalizePhone,
  maskPhone,
  indianMobile,
};
