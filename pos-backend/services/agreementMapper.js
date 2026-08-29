/**
 * Maps a signed agreement onto the fields needed to create a store.
 *
 * Isolated from the controller and pure, because this mapping is the part
 * most likely to be silently wrong: the two systems were built separately and
 * use different names for the same thing (`r_display` vs restaurantName,
 * `b_gstin` vs gstin). A pure function can be tested against real agreement
 * shapes without a database or a running portal.
 *
 * Agreement field names, as written by the portal's form:
 *   r_display / r_name  restaurant display + legal name
 *   r_address r_city r_state r_pin r_phone r_email r_maps r_type
 *   o_name o_phone o_email o_designation o_whatsapp
 *   b_legalname b_type b_pan b_gst b_gstin b_fssai b_fssai_valid
 *   sales_agent
 */

const str = (v) => String(v ?? "").trim();
const digits = (v) => str(v).replace(/\D/g, "");

/** The portal writes yes/no answers inconsistently across form versions. */
const isYes = (v) => {
  const s = str(v).toLowerCase();
  return s === "yes" || s === "true" || s === "1" || s === "y" || v === true;
};

/**
 * Dates arrive as whatever the agent's browser produced — ISO, dd/mm/yyyy or
 * dd-mm-yyyy. Guess wrong and an FSSAI licence expires in the wrong month, so
 * day-first formats are parsed explicitly rather than handed to `new Date()`,
 * which would read 03/04/2027 as 4 March.
 */
const parseDate = (v) => {
  const s = str(v);
  if (!s) return null;

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
};

/** Indian PIN codes are exactly 6 digits and never start with 0. */
const isValidPin = (p) => /^[1-9]\d{5}$/.test(p);

/**
 * @param {object} agreement  a portal agreement document
 * @returns {{ values, missing, warnings }}
 *   values   – payload shaped for store creation
 *   missing  – required fields the agreement did not supply
 *   warnings – present but suspicious, surfaced for the admin to eyeball
 */
const mapAgreementToStore = (agreement) => {
  const d = agreement?.data || {};
  const missing = [];
  const warnings = [];

  const restaurantName = str(d.r_display) || str(d.r_name) || str(agreement?.r_name);
  const ownerName = str(d.o_name) || str(agreement?.o_name);
  const ownerPhone = digits(d.o_phone).slice(-10);
  const restaurantPhone = digits(d.r_phone).slice(-10);
  const postalCode = digits(d.r_pin);

  if (!restaurantName) missing.push("Restaurant name");
  if (!str(d.r_address)) missing.push("Address");
  if (!str(d.r_city)) missing.push("City");
  if (!str(d.r_state)) missing.push("State");
  if (!isValidPin(postalCode)) missing.push("PIN code");
  if (!ownerName) missing.push("Owner name");
  if (!/^\d{10}$/.test(ownerPhone)) missing.push("Owner phone");

  if (restaurantPhone && !/^\d{10}$/.test(restaurantPhone)) {
    warnings.push("Restaurant phone is not a 10-digit number and was left blank.");
  }

  const gstRegistered = isYes(d.b_gst);
  const gstin = str(d.b_gstin).toUpperCase();
  if (gstRegistered && !gstin) {
    warnings.push("The agreement says the business is GST registered but has no GSTIN.");
  }
  if (!gstRegistered && gstin) {
    // Trust the number over the checkbox — a GSTIN is not filled in by accident.
    warnings.push("A GSTIN is present although the agreement was not marked GST registered.");
  }

  const fssaiNumber = digits(d.b_fssai);
  if (str(d.b_fssai) && !/^\d{14}$/.test(fssaiNumber)) {
    warnings.push("The FSSAI number is not 14 digits and was left blank.");
  }

  const fssaiValidUntil = parseDate(d.b_fssai_valid);
  if (str(d.b_fssai_valid) && !fssaiValidUntil) {
    warnings.push("The FSSAI expiry date could not be understood and was left blank.");
  } else if (fssaiValidUntil && fssaiValidUntil < new Date()) {
    warnings.push("The FSSAI licence in the agreement has already expired.");
  }

  const mapsLink = str(d.r_maps);
  if (mapsLink && !/^https?:\/\//i.test(mapsLink)) {
    warnings.push("The Google Maps link is not a full URL and was left blank.");
  }

  return {
    values: {
      restaurantName,
      addressLine1: str(d.r_address),
      addressLine2: "",
      city: str(d.r_city),
      state: str(d.r_state),
      postalCode: isValidPin(postalCode) ? postalCode : "",
      restaurantPhone: /^\d{10}$/.test(restaurantPhone) ? restaurantPhone : "",
      restaurantType: str(d.r_type),
      mapsLink: /^https?:\/\//i.test(mapsLink) ? mapsLink : "",

      ownerName,
      ownerPhone,
      ownerEmail: str(d.o_email).toLowerCase(),

      // Trust a present GSTIN even if the checkbox disagrees.
      gstRegistered: gstRegistered || !!gstin,
      gstin,
      fssaiNumber: /^\d{14}$/.test(fssaiNumber) ? fssaiNumber : "",
      fssaiValidUntil: fssaiValidUntil ? fssaiValidUntil.toISOString().slice(0, 10) : "",

      legalName: str(d.b_legalname),
      restaurantEmail: str(d.r_email).toLowerCase(),
      salesAgentName: str(d.sales_agent) || str(agreement?.sales_agent),
    },
    missing,
    warnings,
  };
};

module.exports = { mapAgreementToStore, parseDate, isYes };
