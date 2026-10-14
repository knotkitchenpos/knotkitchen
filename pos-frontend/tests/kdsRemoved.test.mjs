import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));

test("the kitchen display is gone: no page, route, export or nav link (owner, 2026-10-13)", () => {
  // The kitchen works from printed KOTs on the Kitchen printer instead.
  assert.equal(exists("src/pages/KDS.jsx"), false);
  // No /kds redirect either: an old bookmark falls to Not Found, with the sidebar.
  assert.doesNotMatch(SRC("src/App.jsx"), /\/kds|\bKDS\b/);
  // The pages barrel went with the lazy pages; App.jsx was its only importer.
  assert.equal(exists("src/pages/index.js"), false);
  assert.doesNotMatch(SRC("src/components/shared/Sidebar.jsx"), /\/kds|IconKitchen/);
  assert.doesNotMatch(SRC("src/hooks/useRealtimeSync.js"), /kds-orders/);
  assert.doesNotMatch(SRC("src/https/index.js"), /kitchen screen/i);
});

test("the backend no longer serves /api/kds (it let any store move another store's orders)", () => {
  const app = fs.readFileSync(new URL("../../pos-backend/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /\/api\/kds/);
});
