import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_FILTERS, activeFilterCount, filtersToSearch, readFilters, syncSearchText, toApiParams } from "./eatsFilters.js";

const where = { lat: 22.572645, lng: 88.363892, label: "Park Street", source: "places" };

test("filters survive a round trip through the URL", () => {
  const f = { ...DEFAULT_FILTERS, q: "biryani", sort: "rating", fast: true, minRating: 4, offers: true, pureVeg: true, cost: "300-600" };
  assert.deepEqual(readFilters(new URLSearchParams(filtersToSearch(f))), f);
  assert.equal(filtersToSearch(DEFAULT_FILTERS), "", "defaults leave the address clean");
  assert.deepEqual(readFilters(new URLSearchParams("tag=biryani&maxPrice=250")), { ...DEFAULT_FILTERS, tag: "biryani", maxPrice: 250 });
});

test("anything unknown in the URL falls back to its default", () => {
  const f = readFilters(new URLSearchParams("sort=cheapest&minRating=5&cost=free&fast=yes&tag=<b>&maxPrice=-4"));
  assert.deepEqual(f, DEFAULT_FILTERS);
});

test("API params: lat/lng rounded to 3 dp, cost buckets as costMin/costMax, defaults left out", () => {
  const p = toApiParams({ filters: { ...DEFAULT_FILTERS, cost: "300-600" }, location: where, mode: "delivery", veg: true });
  assert.deepEqual(p, { lat: 22.573, lng: 88.364, mode: "delivery", veg: 1, costMin: 300, costMax: 600 });
  assert.deepEqual(toApiParams({ filters: { ...DEFAULT_FILTERS, cost: "lt300" }, location: where, mode: "pickup" }), {
    lat: 22.573, lng: 88.364, mode: "pickup", costMax: 299,
  });
  assert.equal(toApiParams({ filters: { ...DEFAULT_FILTERS, cost: "gt600" }, location: where }).costMin, 601);
});

test("API params: no location, no request; a 1-letter word is not a search; page 1 is implied", () => {
  assert.equal(toApiParams({ filters: DEFAULT_FILTERS, location: null, mode: "delivery" }), null);
  assert.equal(toApiParams({ filters: { ...DEFAULT_FILTERS, q: "b" }, location: where }).q, undefined);
  const p = toApiParams({ filters: { ...DEFAULT_FILTERS, q: "bi", tag: "biryani", maxPrice: 250, sort: "eta", fast: true, minRating: 3.5, offers: true, pureVeg: true }, location: where, page: 3 });
  assert.deepEqual(p, { lat: 22.573, lng: 88.364, mode: "delivery", sort: "eta", pureVeg: 1, minRating: 3.5, offers: 1, fast: 1, tag: "biryani", maxPrice: 250, q: "bi", page: 3 });
});

test("the Filters badge counts what narrows the list, not the search word", () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, q: "momo", tag: "momo", sort: "distance", cost: "lt300", offers: true }), 3);
});

test("REGRESSION (C12): a dish chip tapped after one letter is not undone by the search box", () => {
  // ?q=b, then the Biryani chip: ?tag=biryani has no q, so the box empties
  // and the debounce has no "b" left to write back over the chip.
  assert.equal(syncSearchText("b", ""), "");
  // The box's own debounced write leaves it alone, trailing space included.
  assert.equal(syncSearchText("chicken ", "chicken"), "chicken ");
  // Back to ?q=pizza puts it in the box.
  assert.equal(syncSearchText("", "pizza"), "pizza");
  const page = fs.readFileSync(new URL("../eats/pages/SearchPage.jsx", import.meta.url), "utf8");
  // Only a q the box did not write itself replaces the text, so its own
  // debounced write landing late never drops a key typed meanwhile.
  assert.match(page, /wroteQ\.current = q;\s*setSp\(/);
  assert.match(page, /if \(filters\.q !== wroteQ\.current\) setText\(\(t\) => syncSearchText\(t, filters\.q\)\);/);
});

test("REGRESSION (C14): an empty page with more to come fetches on, not 'No restaurants'", () => {
  // The server may return { stores: [], hasMore: true } after the road cut.
  const grid = fs.readFileSync(new URL("../eats/components/StoreCard.jsx", import.meta.url), "utf8");
  assert.match(grid, /if \(!data\.stores\.length && !more && !error\) return loading \? null : empty;/);
  // ...and the sentinel that loads the next page is still rendered for it.
  assert.match(grid, /\{more \? \(\s*<div ref=\{sentinel\}/);
});
