import test from "node:test";
import assert from "node:assert/strict";
import { buildOrder, checkoutState, isMobile, pickupTimes } from "./eatsCheckout.js";
import { cleanAddress, clearProfile, getProfile, removeAddress, saveAddress, saveContact } from "./eatsProfile.js";

const line = (o = {}) => ({ name: "Dosa", quantity: 1, unitPrice: 100, ...o });
const ready = {
  lines: [line()],
  subtotal: 100,
  ordering: { minOrderValue: 0 },
  customer: { name: "Asha", phone: "9876543210" },
  address: { line1: "12 Park St" },
};

test("a complete pickup or delivery order can be paid for", () => {
  assert.equal(checkoutState({ ...ready, orderType: "pickup" }).canSubmit, true);
  assert.equal(checkoutState({ ...ready, orderType: "delivery" }).canSubmit, true);
  assert.equal(checkoutState({ ...ready, placing: true }).canSubmit, false, "not twice while paying");
});

test("the one thing to fix is named, in the order a diner fills the page", () => {
  const r = (o) => checkoutState({ ...ready, ...o }).reason;
  assert.equal(r({ lines: [] }), "Your cart is empty.");
  assert.equal(r({ orderType: "delivery", deliveryBlockedReason: "Too far to deliver." }), "Too far to deliver.");
  assert.equal(r({ availability: { collection: { open: false, reason: "Opens at 4 PM." } } }), "Opens at 4 PM.");
  assert.equal(r({ ordering: { minOrderValue: 250 } }), "Add items worth ₹150 more (minimum order ₹250).");
  assert.equal(r({ orderType: "delivery", lines: [line({ dispatchType: { collection: true, delivery: false, table: false } })] }), "Dosa is not available for delivery.");
  assert.equal(r({ orderType: "delivery", address: { line1: " " } }), "Add your delivery address.");
  assert.equal(r({ orderType: "delivery", address: { line1: "x", postalCode: "012345" } }), "Enter a valid 6-digit pincode.");
  assert.equal(r({ pickupWhen: "later", pickupAt: "" }), "Choose a pickup time.");
  assert.equal(r({ customer: { name: "", phone: "9876543210" } }), "Enter your name.");
  assert.equal(r({ customer: { name: "A", phone: "5876543210" } }), "Enter your 10-digit mobile number.");
});

test("a pickup address or pincode never blocks a pickup order", () => {
  assert.equal(checkoutState({ ...ready, orderType: "pickup", address: { line1: "", postalCode: "1" } }).canSubmit, true);
});

test("the order sent is the store website's: delivery carries the point, pickup no address", () => {
  const pickup = buildOrder({ orderType: "pickup", customer: { name: " Asha ", phone: "98765 43210" }, address: { line1: "x" }, pickupWhen: "later", pickupAt: "2026-11-18T12:00:00.000Z", coupon: { code: "SAVE10" } });
  assert.deepEqual(pickup, { orderType: "pickup", customer: { name: "Asha", phone: "9876543210" }, scheduledFor: "2026-11-18T12:00:00.000Z", deliveryAddress: undefined, couponCode: "SAVE10" });

  const delivery = buildOrder({ orderType: "delivery", customer: { name: "A", phone: "9876543210" }, address: { line1: "12 Park St", line2: "Flat 3", instructions: "Ring twice" }, deliveryPoint: { lat: 22.5, lng: 88.3 } });
  assert.deepEqual(delivery.deliveryAddress, { line1: "12 Park St", line2: "Flat 3", city: "", postalCode: "", instructions: "Ring twice", lat: 22.5, lng: 88.3 });
  assert.equal(delivery.scheduledFor, undefined);
  assert.equal("couponCode" in delivery, false);

  const typed = buildOrder({ orderType: "delivery", customer: {}, address: { line1: "x" } });
  assert.equal("lat" in typed.deliveryAddress, false, "no point invented");
});

test("pickup slots start 30 minutes out on the quarter hour and stay inside the hours", () => {
  const now = new Date(2026, 10, 18, 10, 7);
  const slots = pickupTimes(1, null, now);
  assert.equal(slots[0].getHours() * 60 + slots[0].getMinutes(), 10 * 60 + 45);
  assert.equal(slots.length, 2, "10:45 and 11:00 within an hour");
  assert.deepEqual(pickupTimes(5, [{ from: 12 * 60, to: 13 * 60 }], now).map((t) => t.getHours()), [12, 12, 12, 12]);
  assert.equal(isMobile("9876543210"), true);
  assert.equal(isMobile("1234567890"), false);
});

test("profile: valid details only, one Home and one Work, and Clear wipes it", () => {
  clearProfile();
  saveContact({ name: "Asha", phone: "12345" });
  assert.deepEqual([getProfile().name, getProfile().phone], ["Asha", ""], "an invalid mobile is not kept");
  saveContact({ name: "Asha", phone: "9876543210" });
  assert.equal(getProfile().phone, "9876543210");

  assert.equal(cleanAddress({ line1: "" }), null);
  assert.equal(cleanAddress({ line1: "x", postalCode: "0123" }).postalCode, "");
  assert.equal("lat" in cleanAddress({ line1: "x", lat: "", lng: "" }), false);

  saveAddress({ label: "Home", line1: "1 A Rd", lat: 22.5, lng: 88.3 });
  saveAddress({ label: "Home", line1: "2 B Rd" });
  saveAddress({ label: "Other", line1: "3 C Rd" });
  saveAddress({ label: "Other", line1: "4 D Rd" });
  const work = saveAddress({ label: "Work", line1: "5 E Rd" });
  assert.deepEqual(getProfile().addresses.map((a) => `${a.label}:${a.line1}`), ["Work:5 E Rd", "Other:4 D Rd", "Other:3 C Rd", "Home:2 B Rd"]);
  removeAddress(work.id);
  assert.equal(getProfile().addresses.length, 3);
  clearProfile();
  assert.deepEqual(getProfile(), { name: "", phone: "", addresses: [] });
});

test("ordering again to a saved address does not save it twice", () => {
  clearProfile();
  saveAddress({ label: "Home", line1: "1 A Rd" });
  saveAddress({ label: "Work", line1: "2 B Rd" });
  for (let i = 0; i < 7; i += 1) saveAddress({ label: "Other", line1: "3 C Rd", line2: "Flat 4", postalCode: "700016" });
  assert.deepEqual(
    getProfile().addresses.map((a) => `${a.label}: ${a.line1}`),
    ["Other: 3 C Rd", "Work: 2 B Rd", "Home: 1 A Rd"],
    "one Other, and Home and Work are still there",
  );
  // The same place saved under another label moves to that label.
  saveAddress({ label: "Work", line1: "3 C Rd", line2: "Flat 4", postalCode: "700016" });
  assert.deepEqual(getProfile().addresses.map((a) => `${a.label}: ${a.line1}`), ["Work: 3 C Rd", "Home: 1 A Rd"]);
});
