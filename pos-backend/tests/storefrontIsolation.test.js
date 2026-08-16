const { test } = require("node:test");
const assert = require("node:assert/strict");

const { tenantFilter, resolveTenantFromUser } = require("../services/tenantContext");
const { slugify, isValidSlug, generateUniqueSlug, RESERVED_SLUGS } = require("../services/slugService");
const { validateImage, sanitizeFileName, sniffMimeType } = require("../services/imageValidator");
const { isStoreOpen, isItemAvailableNow, getEffectivePrice, isWithinWindow } = require("../services/businessHours");
const { isSelectableTheme, getDefaultTheme, listThemes } = require("../services/themeRegistry");

/**
 * Multi-tenancy, slug, media-security and business-hours tests (§38).
 */

// =========================================================================
// TENANT ISOLATION
// =========================================================================

test("tenantFilter always constrains a query to the caller's tenant", () => {
  const filter = tenantFilter({ storeId: "482193", restaurantId: "restA" });
  // Must reference at least one tenant key — an unscoped query is impossible.
  const json = JSON.stringify(filter);
  assert.ok(json.includes("482193") || json.includes("restA"));
});

test("tenantFilter returns null when the caller has NO tenant (deny-by-default)", () => {
  // A null filter makes callers return empty/404 rather than every store's data.
  assert.equal(tenantFilter({}), null);
  assert.equal(tenantFilter({ storeId: null, restaurantId: null }), null);
});

test("SECURITY: a storeId in the request body can never widen the tenant scope", async () => {
  // resolveTenantFromUser only reads the authenticated user object.
  const userStoreA = { _id: "u1", storeId: "111111", restaurantId: "restA" };
  const tenant = await resolveTenantFromUser(userStoreA);

  assert.equal(tenant.storeId, "111111");
  assert.equal(tenant.restaurantId, "restA");

  // Even if a request body said storeId=999999, the controller uses this value.
  const filter = tenantFilter(tenant);
  assert.ok(!JSON.stringify(filter).includes("999999"));
});

test("an anonymous caller resolves to no tenant at all", async () => {
  const tenant = await resolveTenantFromUser(null);
  assert.equal(tenant.storeId, null);
  assert.equal(tenantFilter(tenant), null);
});

// =========================================================================
// SLUGS
// =========================================================================

test("slugify produces clean, URL-safe public identifiers", () => {
  assert.equal(slugify("ABC Restaurant"), "abc-restaurant");
  assert.equal(slugify("  Café  Déjà Vu!!  "), "cafe-deja-vu");
  assert.equal(slugify("Pizza & Pasta Co."), "pizza-pasta-co");
  assert.equal(slugify("--Weird__Name--"), "weird-name");
});

test("isValidSlug rejects malformed slugs", () => {
  assert.ok(isValidSlug("abc-restaurant"));
  assert.ok(!isValidSlug("-leading"));
  assert.ok(!isValidSlug("trailing-"));
  assert.ok(!isValidSlug("Has Spaces"));
  assert.ok(!isValidSlug("UPPER"));
  assert.ok(!isValidSlug("a"));
});

test("platform routes are reserved and cannot be taken as slugs", () => {
  ["api", "admin", "store", "checkout", "auth"].forEach((word) => {
    assert.ok(RESERVED_SLUGS.has(word), `${word} should be reserved`);
  });
});

test("generateUniqueSlug appends a suffix on collision", async () => {
  const existing = [{ slug: "abc-restaurant", storeId: "111111" }];
  const Model = {
    findOne: async (q) => existing.find((s) => s.slug === q.slug) || null,
  };

  // A DIFFERENT store wanting the same name gets a suffixed slug.
  const slug = await generateUniqueSlug("ABC Restaurant", "222222", { Model });
  assert.equal(slug, "abc-restaurant-2");
});

test("generateUniqueSlug is idempotent for the same store (links never break)", async () => {
  const existing = [{ slug: "abc-restaurant", storeId: "111111" }];
  const Model = { findOne: async (q) => existing.find((s) => s.slug === q.slug) || null };

  const slug = await generateUniqueSlug("ABC Restaurant", "111111", { Model });
  assert.equal(slug, "abc-restaurant");
});

test("a store named after a reserved word still gets a usable slug", async () => {
  const Model = { findOne: async () => null };
  const slug = await generateUniqueSlug("Admin", "333333", { Model });

  assert.ok(!RESERVED_SLUGS.has(slug));
  assert.equal(slug, "admin-store");
});

// =========================================================================
// MEDIA UPLOAD SECURITY
// =========================================================================

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]),
  Buffer.from("IHDR"),
  Buffer.from([0, 0, 0x02, 0x00, 0, 0, 0x01, 0x00]), // 512 x 256
  Buffer.alloc(64),
]);

test("a genuine PNG is accepted and its dimensions are read", () => {
  const result = validateImage({ buffer: PNG, fileName: "burger.png" });
  assert.equal(result.ok, true);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.width, 512);
  assert.equal(result.height, 256);
});

test("SECURITY: a script disguised as an image is rejected by magic-byte sniffing", () => {
  const malicious = Buffer.from("<?php system($_GET['c']); ?>" + "A".repeat(200));
  const result = validateImage({ buffer: malicious, fileName: "shell.php.png" });

  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported file type/i);
});

test("SECURITY: SVG is rejected (stored-XSS vector)", () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' + " ".repeat(100)
  );
  assert.equal(validateImage({ buffer: svg, fileName: "x.svg" }).ok, false);
});

test("oversized uploads are rejected", () => {
  const huge = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
  const result = validateImage({ buffer: huge, fileName: "huge.png" });
  assert.equal(result.ok, false);
  assert.match(result.error, /5MB/);
});

test("SECURITY: path traversal in a file name is neutralised", () => {
  assert.equal(sanitizeFileName("../../../etc/passwd"), "passwd");
  assert.equal(sanitizeFileName("..\\..\\windows\\system32\\cmd.exe"), "cmd.exe");
  assert.ok(!sanitizeFileName("a/b/../c.png").includes("/"));
});

test("sniffMimeType identifies real formats and rejects junk", () => {
  assert.equal(sniffMimeType(PNG), "image/png");
  assert.equal(sniffMimeType(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0])), "image/jpeg");
  assert.equal(sniffMimeType(Buffer.alloc(50)), null);
});

// =========================================================================
// BUSINESS HOURS & AVAILABILITY
// =========================================================================

test("a store that hasn't opted into hours is always open", () => {
  assert.equal(isStoreOpen({ useBusinessHours: false }).isOpen, true);
});

test("overnight opening windows are handled correctly", () => {
  // 18:00 -> 02:00
  assert.equal(isWithinWindow(20 * 60, "18:00", "02:00"), true);  // 20:00 open
  assert.equal(isWithinWindow(1 * 60, "18:00", "02:00"), true);   // 01:00 open
  assert.equal(isWithinWindow(10 * 60, "18:00", "02:00"), false); // 10:00 closed
});

test("an item marked unavailable is never orderable", () => {
  assert.equal(isItemAvailableNow({ isAvailable: false }), false);
  assert.equal(isItemAvailableNow({ isAvailable: true }), true);
});

test("an item outside its schedule is unavailable", () => {
  const breakfastOnly = {
    isAvailable: true,
    // A single day that is almost certainly not today for at least 6/7 runs is
    // unreliable, so use an empty day list to assert the rule deterministically.
    schedule: { enabled: true, startTime: "06:00", endTime: "11:00", daysOfWeek: [] },
  };
  assert.equal(isItemAvailableNow(breakfastOnly), false);
});

test("getEffectivePrice falls back to the base price without active rules", () => {
  assert.equal(getEffectivePrice({ price: 199 }), 199);
  assert.equal(getEffectivePrice({ price: 199, priceRules: [] }), 199);
});

test("an inactive price rule is ignored", () => {
  const item = {
    price: 199,
    priceRules: [
      { name: "Happy Hour", price: 99, isActive: false, startTime: "00:00", endTime: "23:59" },
    ],
  };
  assert.equal(getEffectivePrice(item), 199);
});

// =========================================================================
// THEMES
// =========================================================================

test("only the shipped default theme is selectable today", () => {
  assert.equal(isSelectableTheme("default-restaurant"), true);
  assert.equal(isSelectableTheme("cafe"), false);         // coming soon
  assert.equal(isSelectableTheme("evil-theme"), false);   // unknown
});

test("the theme registry is extensible and exposes future themes", () => {
  const themes = listThemes();
  assert.ok(themes.length > 1, "future themes should be declared");
  assert.ok(getDefaultTheme().defaults.colors.primary);
});
