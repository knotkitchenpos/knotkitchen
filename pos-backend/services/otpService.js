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

module.exports = {
  normalizePhone,
  maskPhone,
};
