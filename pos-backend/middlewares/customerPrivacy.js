/**
 * A customer's phone number is the store's to see on the day of the order,
 * and nobody's after that.
 *
 * The till needs the number today: to call about a delivery, to send the
 * e-bill, to tell two "Rahul"s apart. Tomorrow it is just a list of phone
 * numbers sitting in Orders and Reports for anyone with a login to copy. So
 * every POS response masks the middle of the number on any record older
 * than today: 98******10. The name stays; the record stays whole in the
 * database (the e-bill, refunds and the CSD console read it there), and only
 * KnotKitchen's own support console (/api/csd) is served the full number.
 *
 * Done once, on the way out, rather than in each controller: a new endpoint
 * that returns an order is covered without anyone remembering to.
 */

const STORE_TIMEZONE = "Asia/Kolkata";

/** YYYY-MM-DD of a moment, in the store's timezone. "" when it is not a date. */
const dayOf = (value, timeZone = STORE_TIMEZONE) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone });
};

/** 9876543210 -> 98******10. Anything too short to keep four digits of is fully masked. */
const maskPhone = (phone) => {
  const raw = String(phone || "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (digits.length < 6) return "******";
  return `${digits.slice(0, 2)}******${digits.slice(-2)}`;
};

// When a record happened. The first one present wins.
const DATE_KEYS = ["orderDate", "createdAt", "openedAt", "bookingDate", "dateTime", "paidAt"];
// Where a customer's number lives on a record.
const CUSTOMER_OBJECTS = ["customerDetails", "customerInformation", "customer"];
const PHONE_KEYS = ["phone", "customerPhone", "mobile", "contactPhone"];

const recordDay = (node, inherited) => {
  for (const key of DATE_KEYS) {
    if (node[key]) {
      const day = dayOf(node[key]);
      if (day) return day;
    }
  }
  return inherited;
};

/**
 * Mask, in place, every customer phone on a record dated before `today`.
 * A record with no date of its own takes its parent's; with none at all it
 * is left alone (it is not an order).
 */
const maskOldCustomerPhones = (node, today, inherited = "") => {
  if (Array.isArray(node)) {
    node.forEach((child) => maskOldCustomerPhones(child, today, inherited));
    return node;
  }
  if (!node || typeof node !== "object") return node;

  const day = recordDay(node, inherited);
  const old = Boolean(day) && day < today;

  if (old) {
    if (typeof node.customerPhone === "string" || typeof node.customerPhone === "number") {
      node.customerPhone = maskPhone(node.customerPhone);
    }
    for (const key of CUSTOMER_OBJECTS) {
      const customer = node[key];
      if (!customer || typeof customer !== "object") continue;
      for (const p of PHONE_KEYS) {
        if (customer[p]) customer[p] = maskPhone(customer[p]);
      }
    }
    if (node.deliveryAddress && typeof node.deliveryAddress === "object") {
      for (const p of PHONE_KEYS) {
        if (node.deliveryAddress[p]) node.deliveryAddress[p] = maskPhone(node.deliveryAddress[p]);
      }
    }
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === "object") maskOldCustomerPhones(value, today, day);
  }
  return node;
};

/**
 * Express middleware for the POS routers. KnotKitchen support working inside
 * a store's POS (req.csdStaff) is served the record as it is.
 */
const customerPrivacy = (req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    if (req.csdStaff || !body || typeof body !== "object") return send(body);
    try {
      // Mongoose documents serialise through toJSON; work on the plain copy.
      const plain = JSON.parse(JSON.stringify(body));
      return send(maskOldCustomerPhones(plain, dayOf(new Date())));
    } catch (err) {
      console.warn("[customerPrivacy] could not mask a response:", err.message);
      return send(body);
    }
  };
  next();
};

module.exports = { customerPrivacy, maskOldCustomerPhones, maskPhone, dayOf };
