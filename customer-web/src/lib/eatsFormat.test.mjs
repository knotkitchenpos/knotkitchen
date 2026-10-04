import test from "node:test";
import assert from "node:assert/strict";
import { costLabel, deliveryBlockReason, distanceLabel, etaLabel, inr, ratingView, tagText } from "./eatsFormat.js";

test("ETA reads as a range of minutes", () => {
  assert.equal(etaLabel({ min: 35, max: 45 }), "35-45 mins");
  assert.equal(etaLabel({ min: 20, max: 20 }), "20 mins");
  assert.equal(etaLabel(null), "");
});

test("distance: metres under 1 km, one decimal below 10 km, ~ for a straight-line guess", () => {
  assert.equal(distanceLabel(0.853, "road"), "850 m");
  assert.equal(distanceLabel(0.999, "road"), "1.0 km");
  assert.equal(distanceLabel(2.1, "road"), "2.1 km");
  assert.equal(distanceLabel(2.14, "straight_line"), "~2.1 km");
  assert.equal(distanceLabel(0.4, "straight_line"), "~400 m");
  assert.equal(distanceLabel(12.4, "road"), "12 km");
  assert.equal(distanceLabel(null, null), "", "no location: no distance, not 0 m");
});

test("rating: New below 3 ratings; the label says it in words", () => {
  assert.equal(ratingView(null, 0).text, "New");
  assert.equal(ratingView(4.8, 2).text, "New", "a stray low count never shows an average");
  assert.equal(ratingView(4.8, 2).label, "New on Knot Eats");
  const v = ratingView(4.3, 27);
  assert.equal(v.text, "4.3");
  assert.equal(v.label, "Rated 4.3 out of 5 from 27 ratings");
  assert.equal(v.tone, "good");
  assert.equal(ratingView(3.2, 5).tone, "ok");
  assert.equal(ratingView(2.1, 5).tone, "bad");
});

test("rupees in Indian grouping; cost for two; tag labels from the config", () => {
  assert.equal(inr(125000), "₹1,25,000");
  assert.equal(costLabel(400), "₹400 for two");
  assert.equal(costLabel(0), "");
  assert.equal(tagText(["biryani", "tea-coffee", "roll", "pizza"], [{ tag: "biryani", label: "Biryani" }]), "Biryani, Tea coffee, Roll");
});

test("deliveryBlockReason: location first, then an area centroid, then the server's reason", () => {
  const ok = { deliverable: true, reason: "" };
  const far = { deliverable: false, reason: "Delivers within 7 km; you are 9.2 km away." };
  assert.equal(deliveryBlockReason(ok, null), "Set your delivery location to get delivery");
  assert.equal(deliveryBlockReason(ok, { lat: 22.58, lng: 88.41, source: "area" }), "Set your exact location to get delivery");
  assert.equal(deliveryBlockReason(far, { lat: 22.5, lng: 88.3, source: "gps" }), far.reason);
  assert.equal(deliveryBlockReason(ok, { lat: 22.5, lng: 88.3, source: "places" }), "");
  assert.equal(deliveryBlockReason(null, { lat: 22.5, lng: 88.3, source: "gps" }), "", "not known yet: the server decides at checkout");
});
