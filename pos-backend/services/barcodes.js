const mongoose = require("mongoose");

/**
 * Barcodes on packets (owner, 2026-11-03). Scanning a packet finds the item
 * it is linked to; a barcode no item has yet is looked up, so a new item comes
 * filled in: first in KnotKitchen's own list (products stores have named,
 * and Open Food Facts answers kept), then on Open Food Facts itself. Only the
 * barcode number leaves for the lookup, nothing about the store.
 */

const OFF_URL = (code) =>
  `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_en,generic_name,brands,quantity,product_quantity,product_quantity_unit,categories_tags`;
// Open Food Facts asks every app to name itself.
const USER_AGENT = "KnotKitchen POS/1.0 (support@knotkitchen.com)";
// "Not on Open Food Facts" is asked again after this long: products get added.
const RECHECK_MS = 7 * 86400000;

/** A barcode as scanned or typed, or null: EAN/UPC digits, or a store's own code. */
const normalizeCode = (v) => {
  const code = String(v ?? "").trim().replace(/\s+/g, "");
  if (/^\d+$/.test(code)) return code.length >= 6 && code.length <= 14 ? code : null;
  return /^[0-9A-Za-z.\-_/]{4,32}$/.test(code) ? code : null;
};

const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * A packet's size as our units: "1 kg" -> 1 kg, "500 g" -> 500 g,
 * "1.5 l" -> 1.5 L, "6 x 330 ml" -> a pack of 6 pieces. Unknown: one piece.
 */
const parseQuantity = (text = "", quantity, quantityUnit) => {
  const t = String(text || "").toLowerCase().replace(/,/g, ".");
  const multi = t.match(/(\d+)\s*[x×*]\s*\d/);
  if (multi && Number(multi[1]) > 1) return { unit: "pcs", size: Number(multi[1]), label: `Pack of ${multi[1]}` };
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|g|gm|gms|gram|grams|mg|l|ltr|litre|liter|ml|cl|pcs|pc|pieces|piece|n|units?)\b/);
  let n = m ? Number(m[1]) : Number(quantity);
  let u = m ? m[2] : String(quantityUnit || "").toLowerCase();
  if (!(n > 0)) return { unit: "pcs", size: 1, label: "" };
  if (["kg", "kilo"].includes(u)) return { unit: "kg", size: round3(n), label: "Pack" };
  if (["g", "gm", "gms", "gram", "grams"].includes(u)) return n >= 1000 ? { unit: "kg", size: round3(n / 1000), label: "Pack" } : { unit: "g", size: round3(n), label: "Pack" };
  if (u === "mg") return { unit: "g", size: round3(n / 1000), label: "Pack" };
  if (["l", "ltr", "litre", "liter"].includes(u)) return { unit: "L", size: round3(n), label: "Bottle" };
  if (u === "cl") { n *= 10; u = "ml"; }
  if (u === "ml") return n >= 1000 ? { unit: "L", size: round3(n / 1000), label: "Bottle" } : { unit: "ml", size: round3(n), label: "Bottle" };
  if (["pcs", "pc", "pieces", "piece", "n", "unit", "units"].includes(u)) return { unit: "pcs", size: round3(n), label: n > 1 ? `Pack of ${n}` : "" };
  return { unit: "pcs", size: 1, label: "" };
};

/** Open Food Facts' categories as ours. */
const categoryOf = (tags = []) => {
  const t = (Array.isArray(tags) ? tags : []).join(" ");
  if (/dair|chees|milk|butter|yogurt|yoghurt|cream|paneer|curd/.test(t)) return "dairy";
  if (/beverage|drink|water|soda|juice|tea|coffee|soft-drink/.test(t)) return "beverage";
  if (/seafood|fish|prawn|shrimp/.test(t)) return "seafood";
  if (/meat|poultry|chicken|mutton|sausage|ham|bacon/.test(t)) return "meat";
  if (/fruit|vegetable|fresh/.test(t)) return "produce";
  return t ? "dry_goods" : "other";
};

/** What the screens show of a product, whichever list it came from. */
const productView = (p) =>
  p && p.name
    ? { code: p.code, name: p.name, brand: p.brand || "", quantityText: p.quantityText || "", unit: p.unit || "pcs", size: p.size || 1, category: p.category || "other", source: p.source || "" }
    : null;

/** Ask Open Food Facts. null when it has nothing; throws when it could not be reached. */
const askOpenFoodFacts = async (code) => {
  const res = await fetch(OFF_URL(code), { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts answered ${res.status}`);
  const body = await res.json();
  const p = body?.product;
  if (body?.status !== 1 || !p) return null;
  const brand = String(p.brands || "").split(",")[0].trim();
  const base = String(p.product_name_en || p.product_name || p.generic_name || "").trim();
  if (!base) return null;
  // "Amul Processed Cheese" rather than "Processed Cheese" when the brand is not in the name already.
  // A company ("Coca-Cola Services SA/NV") is not a brand to put in front.
  const isBrand = brand && brand.split(/\s+/).length <= 2 && !/\b(ltd|limited|pvt|inc|llc|sa|nv|gmbh|services|company|co\.?|corp)\b/i.test(brand);
  const name = isBrand && !base.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${base}` : base;
  const q = parseQuantity(p.quantity, p.product_quantity, p.product_quantity_unit);
  return { name: name.slice(0, 120), brand: brand.slice(0, 80), quantityText: String(p.quantity || "").slice(0, 40), unit: q.unit, size: q.size, category: categoryOf(p.categories_tags) };
};

/**
 * What a barcode is: KnotKitchen's list first, then Open Food Facts (its
 * answer kept in our list). null when nobody knows it, or Open Food Facts
 * could not be reached (then nothing is kept, and the next scan asks again).
 */
const lookupProduct = async (code, { ask = askOpenFoodFacts } = {}) => {
  const { BarcodeProduct } = require("../models/inventoryModel");
  const known = await BarcodeProduct.findOne({ code }).lean();
  if (known?.name) return productView(known);
  if (known?.notFound && known.checkedAt && Date.now() - new Date(known.checkedAt).getTime() < RECHECK_MS) return null;
  let found;
  try {
    found = await ask(code);
  } catch (e) {
    console.warn("[barcodes] Open Food Facts lookup failed:", e?.message || e);
    return null;
  }
  const set = found
    ? { ...found, source: "openfoodfacts", notFound: false, checkedAt: new Date() }
    : { notFound: true, checkedAt: new Date() };
  const doc = await BarcodeProduct.findOneAndUpdate({ code }, { $set: set }, { new: true, upsert: true }).lean();
  return productView(doc);
};

/**
 * A store linked a barcode to one of its items: KnotKitchen's list learns the
 * product, unless it already has a name for it (Open Food Facts', or the
 * store that named it first). Never fails the save it came from.
 */
const learnProduct = async ({ code, name, unit, size, category }) => {
  if (!code || !name || mongoose.connection?.readyState !== 1) return;
  try {
    const { BarcodeProduct } = require("../models/inventoryModel");
    await BarcodeProduct.updateOne({ code }, { $inc: { stores: 1 } });
    await BarcodeProduct.updateOne(
      { code, $or: [{ name: "" }, { name: { $exists: false } }] },
      { $set: { name: String(name).slice(0, 120), unit, size, category, source: "knotkitchen", notFound: false, checkedAt: new Date() }, $setOnInsert: { stores: 1 } },
      { upsert: true },
    );
  } catch (e) {
    if (e?.code !== 11000) console.warn("[barcodes] product not learned:", e?.message || e);
  }
};

module.exports = { normalizeCode, parseQuantity, categoryOf, lookupProduct, learnProduct, productView, askOpenFoodFacts };
