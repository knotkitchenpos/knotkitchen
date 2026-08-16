/**
 * liveMenuImportTest.js
 *
 * End-to-end check of the Structured Notepad Menu Import against a real
 * database and the real Express routes:
 *
 *   template -> .txt -> POST /preview -> POST /import -> GET /api/menu
 *
 * Creates its own throwaway user and deletes everything it made on the way out.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const config = require("../config/config");

const Menu = require("../models/menuModel");
const User = require("../models/userModel");
const { MENU_TEMPLATE } = require("../services/menuTemplate");

const log = (ok, msg) => console.log(`${ok ? "[PASS]" : "[FAIL]"} ${msg}`);
let failures = 0;
const check = (cond, msg) => {
  if (!cond) failures++;
  log(cond, msg);
  return cond;
};

(async () => {
  await mongoose.connect(config.databaseURI);
  console.log(`Connected to: ${mongoose.connection.name}\n`);

  // ---- Throwaway employee account ----
  const stamp = Date.now();
  const user = await User.create({
    name: "Menu Import Test User",
    email: `menu-import-test-${stamp}@knotkitchen.test`,
    phone: String(stamp).slice(-10),
    password: "TestPassword123",
    address: "Test",
    role: "Owner",
  });

  const token = jwt.sign(
    { _id: user._id, role: user.role, restaurantId: user.restaurantId, outletId: user.outletId },
    config.accessTokenSecret,
    { expiresIn: "15m" }
  );

  // ---- Real app wiring ----
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use("/api/menu", require("../routes/menuRoute"));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });

  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Cookie: `accessToken=${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  };

  try {
    // ---------- 1. Template download ----------
    const tpl = await fetch(`${base}/api/menu/import/template`, {
      headers: { Cookie: `accessToken=${token}` },
    });
    const tplText = await tpl.text();
    check(tpl.status === 200, "GET /import/template returns 200");
    check(
      tpl.headers.get("content-disposition")?.includes("knotkitchen-menu-template.txt"),
      "template downloads as a .txt attachment"
    );
    check(tplText.includes("CATEGORY:"), "template contains the CATEGORY command");

    // ---------- 2. Format docs ----------
    const fmt = await call("GET", "/api/menu/import/format");
    check(fmt.status === 200 && fmt.body.success, "GET /import/format returns docs");
    check((fmt.body.data?.sections || []).length > 0, "format docs include instruction sections");
    check((fmt.body.data?.commands || []).length > 0, "format docs include a command reference");

    // ---------- 3. Preview a BAD file ----------
    const bad = await call("POST", "/api/menu/import/preview", {
      text: "CATEGORY: Burgers\nITEM: Chicken Burger\nDESCRIPTION: no price\nEND ITEM",
    });
    check(bad.body.success === false, "preview rejects a file with no price");
    check(bad.body.data?.valid === false, "invalid file is flagged invalid");
    const priceErr = (bad.body.data?.errors || []).find((e) =>
      e.message.includes("requires either a PRICE")
    );
    check(Boolean(priceErr), "error explains a PRICE or VARIANT is required");
    check(typeof priceErr?.line === "number", "error carries a line number");

    // Nothing may have been written by a preview.
    const afterBad = await Menu.countDocuments({ createdBy: user._id });
    check(afterBad === 0, "a rejected preview writes nothing to the database");

    // ---------- 4. Importing a bad file is refused ----------
    const badImport = await call("POST", "/api/menu/import", {
      text: "CATEGORY: X\nITEM: Y\nPRICE: abc\nEND ITEM",
    });
    check(badImport.status === 400, "import of an invalid file returns 400");
    check(
      (await Menu.countDocuments({ createdBy: user._id })) === 0,
      "a refused import writes nothing to the database"
    );

    // ---------- 5. Preview the real template ----------
    const good = await call("POST", "/api/menu/import/preview", { text: MENU_TEMPLATE });
    check(good.body.success === true, "preview accepts the shipped template");
    check(good.body.data?.stats?.categories === 5, "preview reports 5 categories");
    check(typeof good.body.data?.tree === "string", "preview returns a menu tree");
    check(good.body.data.tree.includes("Chicken Burger"), "preview tree lists the dishes");

    // ---------- 6. Import ----------
    const imported = await call("POST", "/api/menu/import", { text: MENU_TEMPLATE });
    check(imported.status === 201, "import returns 201");
    check(imported.body.success === true, "import reports success");
    check((imported.body.data?.created || []).length === 5, "import created 5 categories");

    // ---------- 7. Read it back through the existing menu API ----------
    const menus = await call("GET", "/api/menu");
    const data = menus.body.data || [];
    check(data.length === 5, "GET /api/menu returns the 5 imported categories");

    const pizza = data.find((m) => m.name === "Pizza");
    const margherita = pizza?.items?.find((i) => i.name === "Margherita Pizza");
    check(Boolean(margherita), "Margherita Pizza exists in the Pizza category");
    check(margherita?.variants?.length === 3, "Margherita has 3 variants (one product, not three)");
    check(
      margherita?.modifierGroups?.length === 2,
      "Margherita keeps its 2 add-on groups separate"
    );
    check(Boolean(margherita?._id), "Mongo generated the item _id automatically");

    const burgers = data.find((m) => m.name === "Burgers");
    const chicken = burgers?.items?.find((i) => i.name === "Chicken Burger");
    check(chicken?.price === 249, "Chicken Burger price stored as a number");
    check(chicken?.category === "Burgers", "item carries its category string");
    const extras = chicken?.modifierGroups?.find((g) => g.name === "Extras");
    check(extras?.options?.length === 4, "Extras group has 4 add-ons");
    check(
      extras?.options?.some((o) => o.name === "Ketchup" && o.price === 0),
      "free add-on stored with price 0"
    );

    const combos = data.find((m) => m.name === "Combos");
    const meal = combos?.items?.[0];
    check(meal?.isCombo === true, "combo stored with isCombo = true");
    check(meal?.modifierGroups?.length === 3, "combo has 3 choice groups");
    const drink = meal?.modifierGroups?.find((g) => g.name === "Choose Drink");
    check(drink?.required === true, "required choice group stored as required");
    check(drink?.minSelections === 1 && drink?.maxSelections === 1, "REQUIRED | 1 | 1 preserved");
    const comboExtras = meal?.modifierGroups?.find((g) => g.name === "Extras");
    check(
      comboExtras?.required === false && comboExtras?.maxSelections === 3,
      "OPTIONAL | 0 | 3 preserved"
    );

    const drinks = data.find((m) => m.name === "Drinks");
    const coke = drinks?.items?.find((i) => i.name === "Coke");
    check(coke?.variants?.length === 3, "Coke has 3 size variants");
    check(coke?.price === 40, "variant-only item uses the cheapest variant as base price");

    // Comments must never reach the database.
    check(
      !JSON.stringify(data).includes("KNOT KITCHEN MENU IMPORT TEMPLATE"),
      "template comments never reach the database"
    );

    // ---------- 8. Re-import merges instead of duplicating ----------
    const again = await call("POST", "/api/menu/import", { text: MENU_TEMPLATE });
    check(again.status === 201, "re-import succeeds");
    check((again.body.data?.updated || []).length === 5, "re-import updates the same 5 categories");
    check(
      (await Menu.countDocuments({ createdBy: user._id })) === 5,
      "re-import does not duplicate categories"
    );

    const reread = await call("GET", "/api/menu");
    const burgersAgain = (reread.body.data || []).find((m) => m.name === "Burgers");
    check(burgersAgain?.items?.length === 2, "re-import does not duplicate dishes");
  } finally {
    // ---- Clean up ----
    await Menu.deleteMany({ createdBy: user._id });
    await User.deleteOne({ _id: user._id });
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
