/**
 * Knot Eats road distances (services/distanceService.roadDistances).
 *
 * Google is optional and metered: no key, a spent budget, a timeout or "no
 * route" must all fall back to straight-line km without throwing, fallbacks
 * must never be cached, and the key must only ever travel in a header.
 */
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const cfg = { googleMapsServerKey: "", googleRoutesDailyElements: 300 };
const orig = Module._load;
Module._load = function (request, parent) {
  if (request === "../config/config" && /distanceService\.js$/.test(parent?.filename || "")) return cfg;
  return orig.apply(this, arguments);
};
const { roadDistances, resetRoadDistances, mapsUsage, haversineKm } = require("../services/distanceService");
Module._load = orig;

const ORIGIN = { lat: 22.57261, lng: 88.36389 };
const STORE = { key: "231146", lat: 22.5800, lng: 88.4100 };

let calls;
const stubFetch = (impl) => {
  calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
};
const reply = (rows, status = 200) => ({ ok: status < 400, status, json: async () => rows });
const routeFor = (n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({
    ...(i ? { originIndex: i } : {}), // proto3 JSON omits index 0
    destinationIndex: 0,
    condition: "ROUTE_EXISTS",
    distanceMeters: 4321,
    duration: "754s",
    ...extra,
  }));

beforeEach(() => {
  resetRoadDistances();
  Object.assign(cfg, { googleMapsServerKey: "", googleRoutesDailyElements: 300 });
  stubFetch(async () => reply([]));
});

test("no key: zero fetches, straight-line distance and a ~20 km/h ETA", async () => {
  const out = await roadDistances({ origin: ORIGIN, stores: [STORE] });
  assert.equal(calls.length, 0);
  const d = out.get("231146");
  assert.equal(d.source, "straight_line");
  assert.equal(d.km, haversineKm(STORE.lat, STORE.lng, 22.573, 88.364));
  assert.equal(d.minutes, Math.round(d.km * 3));
});

test("with a key: one fetch per page, then the same origin is served from cache", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => reply(routeFor(3)));
  const stores = [STORE, { key: "100001", lat: 22.6, lng: 88.4 }, { key: "100002", lat: 22.61, lng: 88.41 }];
  const first = await roadDistances({ origin: ORIGIN, stores });
  assert.equal(calls.length, 1);
  assert.deepEqual(first.get("231146"), { km: 4.3, minutes: 13, source: "road" });
  assert.equal(first.get("100001").source, "road", "index 0 omitted by proto3 still maps to stores[0]");

  // ~25 m away: the same 3-dp origin, so the same cache entry.
  const again = await roadDistances({ origin: { lat: 22.57281, lng: 88.36411 }, stores });
  assert.equal(calls.length, 1);
  assert.equal(again.get("100002").source, "road");
  assert.equal(mapsUsage().used, 3);
});

test("a moved store pin misses the cache", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => reply(routeFor(1)));
  await roadDistances({ origin: ORIGIN, stores: [STORE] });
  await roadDistances({ origin: ORIGIN, stores: [{ ...STORE, lat: STORE.lat + 0.01 }] });
  assert.equal(calls.length, 2);
});

test("budget exhausted: no fetch, straight line", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  cfg.googleRoutesDailyElements = 2;
  stubFetch(async () => reply(routeFor(3)));
  const stores = [STORE, { key: "100001", lat: 22.6, lng: 88.4 }, { key: "100002", lat: 22.61, lng: 88.41 }];
  const out = await roadDistances({ origin: ORIGIN, stores });
  assert.equal(calls.length, 0, "3 elements would pass the cap of 2");
  assert.ok([...out.values()].every((d) => d.source === "straight_line"));
  assert.deepEqual([mapsUsage().used, mapsUsage().cap], [0, 2]);
});

test("a timeout or a throw falls back, and nothing is cached", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => {
    throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
  });
  const out = await roadDistances({ origin: ORIGIN, stores: [STORE] });
  assert.equal(out.get("231146").source, "straight_line");
  await roadDistances({ origin: ORIGIN, stores: [STORE] });
  assert.equal(calls.length, 2, "the failure was not cached");

  stubFetch(async () => reply({ error: "x" }, 500));
  assert.equal((await roadDistances({ origin: ORIGIN, stores: [STORE] })).get("231146").source, "straight_line");
});

test("ROUTE_NOT_FOUND falls back and is not cached", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => reply(routeFor(1, { condition: "ROUTE_NOT_FOUND", distanceMeters: undefined })));
  assert.equal((await roadDistances({ origin: ORIGIN, stores: [STORE] })).get("231146").source, "straight_line");
  await roadDistances({ origin: ORIGIN, stores: [STORE] });
  assert.equal(calls.length, 2);
});

test("fetchAllowed: false reads the cache only", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => reply(routeFor(1)));
  const out = await roadDistances({ origin: ORIGIN, stores: [STORE], fetchAllowed: false });
  assert.equal(calls.length, 0);
  assert.equal(out.get("231146").source, "straight_line");
});

test("SECURITY: the key travels in a header, never the URL; field mask set; duration parses", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async () => reply(routeFor(1)));
  const out = await roadDistances({ origin: ORIGIN, stores: [STORE] });
  const [{ url, init }] = calls;
  assert.equal(url, "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix");
  assert.ok(!url.includes("test-server-key") && !url.includes("key="));
  assert.equal(init.headers["X-Goog-Api-Key"], "test-server-key");
  assert.equal(init.headers["X-Goog-FieldMask"], "originIndex,destinationIndex,status,condition,distanceMeters,duration");
  const body = JSON.parse(init.body);
  assert.equal(body.travelMode, "DRIVE");
  assert.equal(body.routingPreference, "TRAFFIC_UNAWARE");
  // Store pins are the origins; the customer (rounded to 3 dp) is the destination.
  assert.deepEqual(body.origins[0].waypoint.location.latLng, { latitude: STORE.lat, longitude: STORE.lng });
  assert.deepEqual(body.destinations[0].waypoint.location.latLng, { latitude: 22.573, longitude: 88.364 });
  assert.ok(init.signal, "a timeout is attached");
  assert.equal(out.get("231146").minutes, 13, "754s rounds up to 13 min");
});

test("pages beyond 25 stores go in batches of 25", async () => {
  cfg.googleMapsServerKey = "test-server-key";
  stubFetch(async (url, init) => reply(routeFor(JSON.parse(init.body).origins.length)));
  const stores = Array.from({ length: 30 }, (_, i) => ({ key: String(100000 + i), lat: 22.5 + i / 1000, lng: 88.3 }));
  const out = await roadDistances({ origin: ORIGIN, stores });
  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).origins.length), [25, 5]);
  assert.ok([...out.values()].every((d) => d.source === "road"));
});

test("GOOGLE_ROUTES_DAILY_ELEMENTS=0 is a cap of 0 (no paid calls); only blank or junk falls back to 300", async () => {
  const path = require.resolve("../config/config");
  const capFor = (value) => {
    process.env.GOOGLE_ROUTES_DAILY_ELEMENTS = value;
    delete require.cache[path];
    return require("../config/config").googleRoutesDailyElements;
  };
  try {
    assert.deepEqual(["0", "25", "", "junk", "-1"].map(capFor), [0, 25, 300, 300, 300]);
  } finally {
    delete process.env.GOOGLE_ROUTES_DAILY_ELEMENTS;
    delete require.cache[path];
  }

  Object.assign(cfg, { googleMapsServerKey: "test-server-key", googleRoutesDailyElements: 0 });
  const out = await roadDistances({ origin: ORIGIN, stores: [STORE] });
  assert.equal(calls.length, 0, "a cap of 0 never calls Google");
  assert.equal(out.get("231146").source, "straight_line");
});
