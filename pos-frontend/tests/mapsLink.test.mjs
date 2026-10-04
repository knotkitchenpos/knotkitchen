import { test } from "node:test";
import assert from "node:assert/strict";
import { isShortMapsLink, latLngFromMapsUrl } from "../src/utils/mapsLink.js";

test("reads the pin from each Google Maps URL form and a bare pair", () => {
  const at = { lat: 22.5726, lng: 88.3639 };
  assert.deepEqual(latLngFromMapsUrl("https://www.google.com/maps/@22.5726,88.3639,17z"), at);
  assert.deepEqual(latLngFromMapsUrl("https://www.google.com/maps/search/?api=1&query=22.5726,88.3639"), at);
  assert.deepEqual(latLngFromMapsUrl("https://maps.google.com/?q=22.5726%2C88.3639"), at);
  assert.deepEqual(latLngFromMapsUrl("https://maps.google.com/?ll=22.5726,88.3639&z=15"), at);
  assert.deepEqual(latLngFromMapsUrl("https://www.google.com/maps/@?api=1&map_action=map&center=22.5726,88.3639"), at);
  assert.deepEqual(latLngFromMapsUrl("  22.5726 , 88.3639 "), at);
});

test("the dropped pin (!3d!4d) wins over where the map was centred (@)", () => {
  const url = "https://www.google.com/maps/place/Shop/@22.5000,88.3000,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d22.5726!4d88.3639";
  assert.deepEqual(latLngFromMapsUrl(url), { lat: 22.5726, lng: 88.3639 });
});

test("a short link, out-of-range numbers and junk give null", () => {
  assert.equal(latLngFromMapsUrl("https://maps.app.goo.gl/AbCdEf123"), null);
  assert.ok(isShortMapsLink("https://maps.app.goo.gl/AbCdEf123"));
  assert.ok(isShortMapsLink("goo.gl/maps/xyz"));
  assert.equal(latLngFromMapsUrl("95.1, 88.3"), null);
  assert.equal(latLngFromMapsUrl("22.5, 188.3"), null);
  assert.equal(latLngFromMapsUrl("Salt Lake, Kolkata"), null);
  assert.equal(latLngFromMapsUrl(""), null);
  assert.equal(latLngFromMapsUrl("%E0%A4"), null, "a bad escape must not throw");
});
