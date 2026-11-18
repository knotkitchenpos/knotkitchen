import { allowsFulfilment } from "./dispatch.js";

/**
 * Knot Eats checkout rules, as plain functions (the page is EatsCheckout).
 * The same checks the store website's cart makes (components/CartDrawer.jsx)
 * and the same order it sends: the server prices and re-checks everything,
 * so these only decide what the diner is told before they pay.
 */

/**
 * Later-today pickup slots: every 15 minutes from 30 minutes out, up to the
 * restaurant's pickup window (5 hours by default), never past midnight, and
 * inside its Collection hours when it has some (`windows`, minutes of the day).
 */
export function pickupTimes(windowHours, windows, now = new Date()) {
  const first = new Date(now.getTime() + 30 * 60000);
  first.setMinutes(Math.ceil(first.getMinutes() / 15) * 15, 0, 0);
  const last = new Date(now.getTime() + (Number(windowHours) || 5) * 3600000);
  const out = [];
  for (let t = first; t <= last && t.getDate() === now.getDate(); t = new Date(t.getTime() + 15 * 60000)) {
    const minute = t.getHours() * 60 + t.getMinutes();
    if (!windows || windows.some((w) => minute >= w.from && minute < w.to)) out.push(t);
  }
  return out;
}

export const phoneDigits = (phone) => String(phone || "").replace(/\D/g, "");
/** An Indian mobile, as the POS and table QR require: 10 digits starting 6-9. */
export const isMobile = (phone) => /^[6-9]\d{9}$/.test(phoneDigits(phone));

/**
 * Whether the order can be paid for, and if not, the one thing to fix, in
 * words. `lines` are the cart's lines; `orderType` is already resolved
 * (orderTotals.cartOrderType).
 */
export function checkoutState({
  lines = [],
  subtotal = 0,
  ordering = {},
  availability = null,
  orderType = "pickup",
  deliveryBlockedReason = "",
  customer = {},
  address = {},
  pickupWhen = "now",
  pickupAt = "",
  placing = false,
}) {
  const minOrder = Number(ordering?.minOrderValue || 0);
  const minReached = subtotal >= minOrder;
  const conflicting = lines.filter((l) => !allowsFulfilment(l.dispatchType, orderType));
  const channel = availability?.[orderType === "delivery" ? "delivery" : "collection"];
  const channelClosed = Boolean(channel && !channel.open);
  const delivery = orderType === "delivery";
  const pinBad = delivery && Boolean(address.postalCode) && !/^[1-9]\d{5}$/.test(address.postalCode);
  const needsPickupTime = !delivery && pickupWhen === "later";

  let reason = "";
  if (!lines.length) reason = "Your cart is empty.";
  else if (delivery && deliveryBlockedReason) reason = deliveryBlockedReason;
  else if (channelClosed) reason = channel.reason || `${delivery ? "Delivery" : "Pickup"} is not available right now.`;
  else if (!minReached) reason = `Add items worth ₹${(minOrder - subtotal).toFixed(0)} more (minimum order ₹${minOrder}).`;
  else if (conflicting.length) reason = `${conflicting.map((l) => l.name).join(", ")} ${conflicting.length === 1 ? "is" : "are"} not available for ${delivery ? "delivery" : "pickup"}.`;
  else if (delivery && !String(address.line1 || "").trim()) reason = "Add your delivery address.";
  else if (pinBad) reason = "Enter a valid 6-digit pincode.";
  else if (needsPickupTime && !pickupAt) reason = "Choose a pickup time.";
  else if (!String(customer.name || "").trim()) reason = "Enter your name.";
  else if (!isMobile(customer.phone)) reason = "Enter your 10-digit mobile number.";

  return { canSubmit: !reason && !placing, reason, minReached, conflicting, channelClosed, pinBad };
}

/** The checkout body (StorePage adds the items and the idempotency key). */
export function buildOrder({ orderType, customer, address, deliveryPoint, pickupWhen, pickupAt, coupon }) {
  const delivery = orderType === "delivery";
  const addr = {
    line1: String(address?.line1 || "").trim(),
    line2: String(address?.line2 || "").trim(),
    city: String(address?.city || "").trim(),
    postalCode: String(address?.postalCode || "").trim(),
    instructions: String(address?.instructions || "").trim(),
  };
  // The exact point travels with a delivery order only (the rider needs it).
  const lat = Number(address?.lat ?? deliveryPoint?.lat);
  const lng = Number(address?.lng ?? deliveryPoint?.lng);
  return {
    orderType,
    customer: { name: String(customer?.name || "").trim(), phone: phoneDigits(customer?.phone) },
    scheduledFor: !delivery && pickupWhen === "later" && pickupAt ? pickupAt : undefined,
    deliveryAddress: delivery ? (Number.isFinite(lat) && Number.isFinite(lng) ? { ...addr, lat, lng } : addr) : undefined,
    ...(coupon?.code ? { couponCode: coupon.code } : {}),
  };
}
