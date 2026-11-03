const createHttpError = require("http-errors");
const mongoose = require("mongoose");
const { Ingredient, Recipe, StockMovement } = require("../models/inventoryModel");
const { logActivity } = require("../services/auditService");
const {
  UNITS,
  UNIT_CODES,
  convertQty,
  stockStatus,
  needsRestock,
  saveRecipe,
  cleanRecipeLines,
  trimBatches,
  expiryOf,
  linesCost,
  dishCost,
  cancelReturnMinutesOf,
} = require("../services/inventory");
const { AddonRecipe, StockCount } = require("../models/inventoryModel");
const { countOnSale, turnOffFor, backInStock, answerBackInStock } = require("../services/stockProducts");

/**
 * Inventory: items on the shelf, their stock, the recipes that tie products to
 * them, and the movement log. Every read and write is scoped to the caller's
 * restaurant; nothing here takes a restaurantId from the client.
 */

const scope = (req) => {
  if (!req.user?.restaurantId) throw createHttpError(400, "No restaurant on this account.");
  return { restaurantId: req.user.restaurantId, isDeleted: { $ne: true } };
};
const oid = (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) throw createHttpError(404, "Invalid id!");
  return id;
};
const text = (v, max) => String(v || "").trim().slice(0, max);
const num = (v, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
};
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const emit = (restaurantId, event, payload) => {
  try {
    require("../services/socket").emitToRestaurant(String(restaurantId), event, payload);
  } catch {
    /* no socket in this process: the tills catch up on their next load */
  }
};
/** What the "back in stock" question shows: how many products, for which items. */
const backSummary = ({ products = [], ingredients = [] } = {}) => ({ products: products.length, ingredients });
const CATEGORIES = ["produce", "meat", "seafood", "dairy", "dry_goods", "beverage", "other"];

/** An item as the screens read it: with its status worked out by the one rule. */
const view = (doc, { days = 2 } = {}) => {
  const o = doc?.toObject ? doc.toObject() : doc;
  // Use-by: how much has gone past its date, how much goes within `days`, and the next date.
  const batches = expiryOf(o.batches, { days });
  const sum = (state) => round3(batches.filter((b) => b.state === state).reduce((n, b) => n + b.quantity, 0));
  return {
    ...o,
    status: stockStatus(o),
    expiry: batches.length ? { expired: sum("expired"), soon: sum("soon"), next: batches[0].expiryDate } : null,
  };
};
const refreshFlag = (doc) => {
  doc.isLowStock = needsRestock(stockStatus(doc));
};

const ingredientBody = (body = {}) => {
  const name = text(body.name, 120);
  if (!name) throw createHttpError(400, "Name is required.");
  const unit = UNIT_CODES.includes(body.unit) ? body.unit : "pcs";
  const category = CATEGORIES.includes(body.category) ? body.category : "other";
  const reorderLevel = num(body.reorderLevel) ?? 0;
  const maxLevel = num(body.maxLevel) ?? 0;
  if (maxLevel > 0 && maxLevel <= reorderLevel) {
    throw createHttpError(400, "Maximum stock must be more than the minimum stock.");
  }
  const costPerUnit = num(body.costPerUnit) ?? 0;
  // Packs it is bought in, each a size in the item's own unit (tray = 30 pcs).
  const packs = (Array.isArray(body.packs) ? body.packs : [])
    .map((p) => ({ name: text(p?.name, 40), size: round3(num(p?.size, { min: 0, max: 1e6 }) ?? 0) }))
    .filter((p) => p.name && p.size > 0)
    .slice(0, 10);
  // Days it keeps after it is bought or made: a purchase with no date of its own gets one from this.
  const shelfLifeDays = Math.round(num(body.shelfLifeDays, { min: 0, max: 3650 }) ?? 0);
  return { name, unit, category, reorderLevel, maxLevel, costPerUnit, packs, shelfLifeDays, isPrepared: body.isPrepared === true };
};

/** A prepared item's recipe as sent: how much one batch makes, and what it uses. */
const prepBody = async (restaurantId, body = {}, selfId = null) => {
  const makes = round3(num(body?.prep?.makes, { min: 0, max: 1e6 }) ?? 0);
  const lines = await cleanRecipeLines(restaurantId, body?.prep?.ingredients || []);
  if (selfId && lines.some((l) => String(l.ingredientId) === String(selfId))) {
    throw createHttpError(400, "A prepared item cannot use itself.");
  }
  if (body.isPrepared === true && !(makes > 0)) throw createHttpError(400, "Say how much one batch makes.");
  return { makes: makes || 1, ingredients: lines };
};

/** ₹ worth of `quantity` of an item at its cost price now, signed like the quantity. */
const worth = (ing, quantity) => Math.round((Number(quantity) || 0) * (Number(ing?.costPerUnit) || 0) * 100) / 100;

/** The store's inventory settings, with their defaults. */
const settingsOf = async (restaurantId) => {
  const Restaurant = require("../models/restaurantModel");
  const r = await Restaurant.findById(restaurantId).select("inventorySettings").lean();
  return {
    targetFoodCostPct: Number(r?.inventorySettings?.targetFoodCostPct) || 35,
    expiryAlertDays: Number.isFinite(Number(r?.inventorySettings?.expiryAlertDays)) ? Number(r.inventorySettings.expiryAlertDays) : 2,
    cancelReturnMinutes: cancelReturnMinutesOf(r),
  };
};

/* ------------------------------------------------------------------ items */

const listIngredients = async (req, res, next) => {
  try {
    const s = scope(req);
    const [data, settings] = await Promise.all([Ingredient.find(s).sort({ name: 1 }).lean(), settingsOf(s.restaurantId)]);
    res.status(200).json({ success: true, data: data.map((d) => view(d, { days: settings.expiryAlertDays })), settings });
  } catch (e) { next(e); }
};

/** The items that need restocking now: what the POS alert shows on load. */
const listRestockAlerts = async (req, res, next) => {
  try {
    const s = scope(req);
    const data = await Ingredient.find({ ...s, isLowStock: true }).sort({ stockQuantity: 1 }).lean();
    const items = data.map(view).filter((i) => needsRestock(i.status))
      .map((i) => ({ ingredientId: String(i._id), name: i.name, status: i.status, stockQuantity: round3(i.stockQuantity), unit: i.unit, reorderLevel: i.reorderLevel || 0 }));
    // An empty item still offers to turn off the products on sale that use it.
    for (const i of items.filter((x) => x.status === "out")) i.productsOn = await countOnSale(s.restaurantId, i.ingredientId);
    // Beside `data`, so a till reading only the list still works.
    res.status(200).json({ success: true, data: items, backInStock: backSummary(await backInStock(s.restaurantId)) });
  } catch (e) { next(e); }
};

const createIngredient = async (req, res, next) => {
  try {
    const s = scope(req);
    const fields = ingredientBody(req.body);
    const stockQuantity = round3(num(req.body?.stockQuantity) ?? 0);
    const doc = new Ingredient({
      ...fields,
      prep: fields.isPrepared ? await prepBody(s.restaurantId, req.body) : undefined,
      stockQuantity,
      restaurantId: s.restaurantId,
      outletId: req.user.outletId || undefined,
    });
    refreshFlag(doc);
    await doc.save();
    if (stockQuantity > 0) {
      await StockMovement.create({
        restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
        ingredientId: doc._id, ingredientName: doc.name, type: "adjustment",
        quantity: stockQuantity, value: worth(doc, stockQuantity), unit: doc.unit, reason: "Opening stock", createdBy: req.user._id,
      });
    }
    res.status(201).json({ success: true, data: view(doc) });
  } catch (e) { next(e); }
};

const updateIngredient = async (req, res, next) => {
  try {
    const s = scope(req);
    const doc = await Ingredient.findOne({ _id: oid(req.params.id), ...s });
    if (!doc) throw createHttpError(404, "Ingredient not found!");
    const next_ = ingredientBody({ ...doc.toObject(), ...req.body });
    let prepIn = req.body?.prep;

    // A new unit of the same kind re-states every amount in it (2 kg becomes
    // 2000 g), so the shelf does not jump. Another kind of unit would make
    // every recipe that uses the item wrong, so it is refused while one does.
    if (next_.unit !== doc.unit) {
      const factor = convertQty(1, doc.unit, next_.unit);
      if (factor === null) {
        // Dish recipes, add-on and size recipes, and prepared items' batch recipes all measure it in its old unit.
        const [dishes, addons, prepared] = await Promise.all([
          Recipe.countDocuments({ restaurantId: s.restaurantId, isDeleted: { $ne: true }, "ingredients.ingredientId": doc._id }),
          AddonRecipe.countDocuments({ restaurantId: s.restaurantId, "ingredients.ingredientId": doc._id }),
          Ingredient.countDocuments({ restaurantId: s.restaurantId, isDeleted: { $ne: true }, "prep.ingredients.ingredientId": doc._id }),
        ]);
        const used = dishes + addons + prepared;
        if (used) throw createHttpError(400, `${doc.name} is in ${used} recipe(s). Remove it from them before counting it in ${UNITS[next_.unit].label}.`);
      } else {
        doc.stockQuantity = round3(doc.stockQuantity * factor);
        if (req.body?.reorderLevel === undefined) next_.reorderLevel = round3(doc.reorderLevel * factor);
        if (req.body?.maxLevel === undefined) next_.maxLevel = round3((doc.maxLevel || 0) * factor);
        if (req.body?.costPerUnit === undefined) next_.costPerUnit = round3(doc.costPerUnit / factor);
        if (req.body?.packs === undefined) next_.packs = (doc.packs || []).map((p) => ({ name: p.name, size: round3(p.size * factor) }));
        doc.batches = (doc.batches || []).map((b) => ({ ...(b.toObject ? b.toObject() : b), quantity: round3(b.quantity * factor) }));
        // A prepared item's batch size is in its own unit too: 5 kg of gravy is 5000 g. One typed in anew stands.
        if (doc.prep?.makes && (prepIn?.makes === undefined || Number(prepIn.makes) === Number(doc.prep.makes))) {
          const makes = round3(doc.prep.makes * factor);
          if (prepIn) prepIn = { ...prepIn, makes };
          else doc.prep.makes = makes;
        }
      }
    }
    // Packs are sized in the unit; a unit of another kind leaves them meaningless.
    if (next_.unit !== doc.unit && convertQty(1, doc.unit, next_.unit) === null && req.body?.packs === undefined) next_.packs = [];
    if (req.body?.isPrepared === undefined) next_.isPrepared = doc.isPrepared;
    if (next_.isPrepared && (prepIn !== undefined || req.body?.isPrepared === true)) {
      doc.prep = await prepBody(s.restaurantId, { ...req.body, isPrepared: true, prep: prepIn || doc.prep }, doc._id);
    }
    Object.assign(doc, next_);
    refreshFlag(doc);
    await doc.save();
    res.status(200).json({ success: true, data: view(doc) });
  } catch (e) { next(e); }
};

const deleteIngredient = async (req, res, next) => {
  try {
    const doc = await Ingredient.findOneAndUpdate({ _id: oid(req.params.id), ...scope(req) }, { isDeleted: true }, { new: true });
    if (!doc) throw createHttpError(404, "Ingredient not found!");
    res.status(200).json({ success: true, message: "Ingredient removed." });
  } catch (e) { next(e); }
};

/* -------------------------------------------------------------- movements */

/**
 * Stock in or out by hand.
 *   purchase    quantity bought, in any unit of the item's kind (100 g for a
 *               kg shelf), and what it cost in total (5 pieces for ₹20). The
 *               item's cost price becomes that cost per unit.
 *   waste       quantity lost, with a reason
 *   adjustment  the actual count; the difference is what is recorded
 */
const recordMovement = async (req, res, next) => {
  try {
    const s = scope(req);
    const { type } = req.body || {};
    if (!["purchase", "waste", "adjustment"].includes(type)) throw createHttpError(400, "Type must be purchase, waste or adjustment.");
    const entered = num(req.body?.quantity, { min: 0, max: 1e7 });
    if (entered === null || (type !== "adjustment" && entered <= 0)) throw createHttpError(400, "Quantity must be more than zero.");
    const ing = await Ingredient.findOne({ _id: oid(req.body?.ingredientId), ...s });
    if (!ing) throw createHttpError(404, "Ingredient not found!");

    // Bought by the pack (2 Trays of a 30-piece tray is 60 pieces), or in a unit of the item's kind.
    const pack = req.body?.pack ? (ing.packs || []).find((p) => p.name === req.body.pack) : null;
    if (req.body?.pack && !pack) throw createHttpError(400, `${ing.name} has no pack called ${text(req.body.pack, 40)}.`);
    const unit = pack ? ing.unit : UNIT_CODES.includes(req.body?.unit) ? req.body.unit : ing.unit;
    const quantity = pack ? round3(entered * pack.size) : convertQty(entered, unit, ing.unit);
    if (quantity === null) {
      throw createHttpError(400, `${ing.name} is counted in ${UNITS[ing.unit]?.label || ing.unit}; it cannot take ${UNITS[unit]?.label || unit}.`);
    }
    const cost = type === "purchase" ? round3(num(req.body?.totalCost, { min: 0, max: 1e9 }) ?? 0) : 0;

    const before = Number(ing.stockQuantity) || 0;
    // Stock never goes below nothing: more wasted than is on the shelf is a miscount.
    if (type === "waste" && quantity > round3(before)) {
      throw createHttpError(400, `Only ${round3(Math.max(0, before))} ${UNITS[ing.unit]?.label || ing.unit} of ${ing.name} in stock.`);
    }
    const delta = type === "purchase" ? quantity : type === "waste" ? -quantity : quantity - before;
    // Valued at the cost price before this entry; a purchase at what it cost.
    const value = type === "purchase" && cost > 0 ? cost : worth(ing, delta);
    ing.stockQuantity = round3(before + delta);
    if (type === "purchase" && cost > 0 && quantity > 0) ing.costPerUnit = round3(cost / quantity);
    // A use-by date: the one given, or the item's shelf life from today.
    if (type === "purchase") {
      const given = req.body?.expiryDate ? new Date(req.body.expiryDate) : null;
      const expiryDate = given && !Number.isNaN(given.getTime())
        ? given
        : ing.shelfLifeDays > 0 ? new Date(Date.now() + ing.shelfLifeDays * 86400000) : null;
      if (expiryDate) ing.batches = [...(ing.batches || []), { quantity, expiryDate, receivedAt: new Date() }];
    }
    // Whatever left the shelf left the batch that expires first.
    if (delta < 0 && (ing.batches || []).length) ing.batches = trimBatches(ing.batches, ing.stockQuantity);
    refreshFlag(ing);
    await ing.save();
    const unitNote = pack ? `${entered} ${pack.name}` : unit !== ing.unit ? `${entered} ${UNITS[unit].label}` : "";
    const movement = await StockMovement.create({
      restaurantId: s.restaurantId, outletId: req.user.outletId || undefined,
      ingredientId: ing._id, ingredientName: ing.name, type, quantity: round3(delta), value, unit: ing.unit, cost,
      reason: [unitNote, text(req.body?.reason, 200)].filter(Boolean).join(" · "), createdBy: req.user._id,
    });
    if (type === "waste") {
      await logActivity({ req, action: "Stock Wasted", resource: "Inventory", resourceId: ing._id,
        newValue: `${quantity} ${ing.unit} ${ing.name}`, description: `Wastage: ${quantity} ${ing.unit} ${ing.name}${movement.reason ? ` (${movement.reason})` : ""}` });
    }
    // Stock coming in may free products switched off for want of it: every
    // till is asked whether to turn them back on.
    const back = delta > 0 ? await backInStock(s.restaurantId) : { products: [] };
    emit(s.restaurantId, "inventory:stock", {});
    if (back.products.length) emit(s.restaurantId, "inventory:back", backSummary(back));
    res.status(201).json({ success: true, data: { ingredient: view(ing), movement, backInStock: backSummary(back) } });
  } catch (e) { next(e); }
};

/* ------------------------------------------------- products and the stock */

/**
 * What the POS checks a dish against before ringing it up ("Only 1 Pizza
 * Dough in stock. Do you want to continue?"): each item's stock and every
 * active recipe. Lean, so a till can keep it and check offline.
 */
const stockAvailability = async (req, res, next) => {
  try {
    const s = scope(req);
    const [items, recipes] = await Promise.all([
      Ingredient.find(s).select("_id name unit stockQuantity").lean(),
      Recipe.find({ restaurantId: s.restaurantId, isActive: { $ne: false }, isDeleted: { $ne: true } })
        .select("menuItemId yield ingredients").lean(),
    ]);
    res.status(200).json({
      success: true,
      data: {
        items: items.map((i) => ({ _id: String(i._id), name: i.name, unit: i.unit, stockQuantity: round3(i.stockQuantity) })),
        recipes: recipes.map((r) => ({
          menuItemId: String(r.menuItemId),
          yield: r.yield || 1,
          ingredients: (r.ingredients || []).map((l) => ({ ingredientId: String(l.ingredientId), quantity: l.quantity, unit: l.unit || "" })),
        })),
      },
    });
  } catch (e) { next(e); }
};

/** "Pizza Dough is out of stock. Turn off all products using this item?" Yes. */
const turnOffProducts = async (req, res, next) => {
  try {
    const s = scope(req);
    const ing = await Ingredient.findOne({ _id: oid(req.params.id), restaurantId: s.restaurantId }).select("_id name").lean();
    if (!ing) throw createHttpError(404, "Ingredient not found!");
    const names = await turnOffFor(s.restaurantId, ing._id);
    // The other tills drop the same question.
    emit(s.restaurantId, "inventory:answered", { kind: "off", ingredientId: String(ing._id) });
    await logActivity({ req, action: "Products Turned Off", resource: "Inventory", resourceId: ing._id,
      newValue: names.join(", "), description: `${ing.name} out of stock: turned off ${names.length} product(s)` });
    res.status(200).json({ success: true, data: { count: names.length, products: names } });
  } catch (e) { next(e); }
};

/** "Items are back in stock. Turn on the products turned off for them?" Yes or No. */
const answerBack = async (req, res, next) => {
  try {
    const s = scope(req);
    const turnOn = req.body?.turnOn === true;
    const count = await answerBackInStock(s.restaurantId, turnOn);
    emit(s.restaurantId, "inventory:answered", { kind: "back" });
    if (turnOn && count) {
      await logActivity({ req, action: "Products Turned On", resource: "Inventory",
        newValue: String(count), description: `Back in stock: turned on ${count} product(s)` });
    }
    res.status(200).json({ success: true, data: { count } });
  } catch (e) { next(e); }
};

const listMovements = async (req, res, next) => {
  try {
    const s = scope(req);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const q = { restaurantId: s.restaurantId };
    if (req.query.ingredientId && mongoose.Types.ObjectId.isValid(req.query.ingredientId)) q.ingredientId = req.query.ingredientId;
    const data = await StockMovement.find(q).sort({ createdAt: -1 }).limit(limit).lean();
    res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
};

/* ---------------------------------------------------------------- recipes */

const listRecipes = async (req, res, next) => {
  try {
    const data = await Recipe.find(scope(req)).sort({ menuItemName: 1 }).lean();
    res.status(200).json({ success: true, data });
  } catch (e) { next(e); }
};

const upsertRecipe = async (req, res, next) => {
  try {
    const s = scope(req);
    const doc = await saveRecipe({
      restaurantId: s.restaurantId,
      menuItemId: oid(req.params.menuItemId),
      menuItemName: req.body?.menuItemName,
      enabled: req.body?.enabled !== false,
      ingredients: req.body?.ingredients,
      yieldN: req.body?.yield,
    });
    res.status(200).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

const deleteRecipe = async (req, res, next) => {
  try {
    const doc = await Recipe.findOneAndUpdate({ menuItemId: oid(req.params.menuItemId), ...scope(req) }, { isDeleted: true }, { new: true });
    if (!doc) throw createHttpError(404, "Recipe not found!");
    res.status(200).json({ success: true, message: "Recipe removed." });
  } catch (e) { next(e); }
};

/* -------------------------------------------------------- prepared items */

/**
 * Make a batch of a prepared item (owner, 2026-11-01): 5 kg of gravy takes its
 * recipe, scaled, off the shelf and puts 5 kg of gravy on it, at what those
 * items cost. Short of an item, it says so and asks; `force` makes it anyway
 * (the shelf count is often behind the kitchen).
 */
const makeBatch = async (req, res, next) => {
  try {
    const s = scope(req);
    const ing = await Ingredient.findOne({ _id: oid(req.params.id), ...s });
    if (!ing) throw createHttpError(404, "Ingredient not found!");
    if (!ing.isPrepared || !(ing.prep?.ingredients || []).length) throw createHttpError(400, `${ing.name} has no batch recipe. Set what one batch uses first.`);
    const quantity = round3(num(req.body?.quantity, { min: 0, max: 1e6 }) ?? 0);
    if (!(quantity > 0)) throw createHttpError(400, "Say how much was made.");
    const scale = quantity / Math.max(1e-9, Number(ing.prep.makes) || 1);

    const raws = await Ingredient.find({ _id: { $in: ing.prep.ingredients.map((l) => l.ingredientId) }, ...s });
    const byId = new Map(raws.map((r) => [String(r._id), r]));
    const plan = ing.prep.ingredients
      .map((l) => {
        const raw = byId.get(String(l.ingredientId));
        const need = raw ? convertQty((Number(l.quantity) || 0) * scale, l.unit || raw.unit, raw.unit) : null;
        return raw && need ? { raw, need: round3(need) } : null;
      })
      .filter(Boolean);
    const short = plan.filter((p) => p.need > round3(p.raw.stockQuantity));
    if (short.length && req.body?.force !== true) {
      return res.status(409).json({
        success: false,
        code: "STOCK_SHORT",
        message: `Not enough ${short.map((p) => `${p.raw.name} (needs ${qtyText(p.need, p.raw.unit)}, has ${qtyText(p.raw.stockQuantity, p.raw.unit)})`).join(", ")}.`,
      });
    }

    const why = `Made ${qtyText(quantity, ing.unit)} ${ing.name}`;
    let batchCost = 0;
    for (const { raw, need } of plan) {
      batchCost += need * (Number(raw.costPerUnit) || 0);
      const had = Number(raw.stockQuantity) || 0;
      const taken = round3(Math.min(had, need));
      raw.stockQuantity = round3(had - taken);
      if ((raw.batches || []).length) raw.batches = trimBatches(raw.batches, raw.stockQuantity);
      refreshFlag(raw);
      await raw.save();
      if (taken > 0) {
        await StockMovement.create({
          restaurantId: s.restaurantId, outletId: req.user.outletId || undefined, ingredientId: raw._id, ingredientName: raw.name,
          type: "production", quantity: -taken, value: -worth(raw, taken), unit: raw.unit, reason: why, createdBy: req.user._id,
        });
      }
    }
    batchCost = Math.round(batchCost * 100) / 100;
    ing.stockQuantity = round3((Number(ing.stockQuantity) || 0) + quantity);
    if (batchCost > 0) ing.costPerUnit = round3(batchCost / quantity);
    if (ing.shelfLifeDays > 0) ing.batches = [...(ing.batches || []), { quantity, expiryDate: new Date(Date.now() + ing.shelfLifeDays * 86400000), receivedAt: new Date() }];
    refreshFlag(ing);
    await ing.save();
    await StockMovement.create({
      restaurantId: s.restaurantId, outletId: req.user.outletId || undefined, ingredientId: ing._id, ingredientName: ing.name,
      type: "production", quantity, value: batchCost, unit: ing.unit, reason: short.length ? `${why} (short of ${short.map((p) => p.raw.name).join(", ")})` : why,
      createdBy: req.user._id,
    });
    const back = await backInStock(s.restaurantId);
    emit(s.restaurantId, "inventory:stock", {});
    if (back.products.length) emit(s.restaurantId, "inventory:back", backSummary(back));
    res.status(201).json({ success: true, data: { ingredient: view(ing), batchCost } });
  } catch (e) { next(e); }
};

const qtyText = (n, unit) => `${round3(n)} ${UNITS[unit]?.label || unit}`;

/* ----------------------------------------------------------- dish costing */

/** Every item as costing reads it: name, unit, cost price. */
const costItems = async (restaurantId) =>
  new Map((await Ingredient.find({ restaurantId, isDeleted: { $ne: true } }).select("_id name unit costPerUnit").lean()).map((i) => [String(i._id), i]));

/** The store's products from its menu: id, name, category, price and sizes. */
const menuDishes = async (user) => {
  const Menu = require("../models/menuModel");
  const { userScope } = require("../services/tenantContext");
  const menus = await Menu.find({ ...userScope(user), isDeleted: { $ne: true } }).select("name items").lean();
  return menus.flatMap((m) => (m.items || []).map((it) => ({
    menuItemId: String(it._id), name: it.name, category: m.name, price: Number(it.price) || 0,
    variants: (it.variants || []).map((v) => ({ name: v.name, price: Number(v.price) || 0 })),
    groups: (it.modifierGroups || []).map((g) => ({ name: g.name, options: (g.options || []).map((o) => ({ name: o.name, price: Number(o.price) || 0 })) })),
  })));
};

/**
 * Cost per plate, profit and food-cost % of every product with a recipe
 * (owner, 2026-11-01: "Paneer Tikka costs ₹92 to make, sells for ₹220, food
 * cost 42%"). Above the store's target is flagged.
 */
const dishCosts = async (req, res, next) => {
  try {
    const s = scope(req);
    const [dishes, recipes, items, settings] = await Promise.all([
      menuDishes(req.user),
      Recipe.find({ restaurantId: s.restaurantId, isDeleted: { $ne: true } }).lean(),
      costItems(s.restaurantId),
      settingsOf(s.restaurantId),
    ]);
    const byDish = new Map(recipes.map((r) => [String(r.menuItemId), r]));
    const data = dishes.map((d) => {
      const recipe = byDish.get(d.menuItemId);
      const hasRecipe = Boolean(recipe && (recipe.ingredients || []).length);
      return {
        menuItemId: d.menuItemId, name: d.name, category: d.category, price: d.price, hasRecipe,
        recipeOn: hasRecipe && recipe.isActive !== false,
        ...(hasRecipe ? dishCost({ recipe, price: d.price, items, targetPct: settings.targetFoodCostPct }) : {}),
      };
    });
    res.status(200).json({ success: true, data, settings });
  } catch (e) { next(e); }
};

/* ---------------------------------------------------------- add-on recipes */

/**
 * Every add-on option (from the store's groups) and every product size, with
 * what one portion uses and costs. Extra Cheese, Large.
 */
const listAddonRecipes = async (req, res, next) => {
  try {
    const s = scope(req);
    const MenuGroup = require("../models/menuGroupModel");
    const { userScope } = require("../services/tenantContext");
    const [groups, dishes, saved, items] = await Promise.all([
      MenuGroup.find({ ...userScope(req.user) }).select("name options").sort({ sortOrder: 1, name: 1 }).lean(),
      menuDishes(req.user),
      AddonRecipe.find({ restaurantId: s.restaurantId }).lean(),
      costItems(s.restaurantId),
    ]);
    const lower = (v) => String(v || "").trim().toLowerCase();
    const find = (pred) => saved.find(pred);
    const withCost = (recipe) => {
      const ingredients = recipe?.ingredients || [];
      return { ingredients, ...linesCost(ingredients, items) };
    };
    // The store's group list, plus any group found only on products (older stores).
    const known = new Set(groups.map((g) => lower(g.name)));
    for (const d of dishes) {
      for (const g of d.groups) {
        if (known.has(lower(g.name))) continue;
        known.add(lower(g.name));
        groups.push(g);
      }
    }
    const options = groups.flatMap((g) => (g.options || []).map((o) => ({
      kind: "option", groupName: g.name, optionName: o.name, price: Number(o.price) || 0,
      ...withCost(find((r) => r.kind === "option" && lower(r.groupName) === lower(g.name) && lower(r.optionName) === lower(o.name))),
    })));
    const variants = dishes.flatMap((d) => d.variants.map((v) => ({
      kind: "variant", menuItemId: d.menuItemId, productName: d.name, variantName: v.name, price: v.price,
      ...withCost(find((r) => r.kind === "variant" && String(r.menuItemId) === d.menuItemId && lower(r.variantName) === lower(v.name))),
    })));
    res.status(200).json({ success: true, data: { options, variants } });
  } catch (e) { next(e); }
};

/** Save what one portion of an add-on or size uses; no lines removes it. */
const saveAddonRecipe = async (req, res, next) => {
  try {
    const s = scope(req);
    const kind = req.body?.kind === "variant" ? "variant" : req.body?.kind === "option" ? "option" : null;
    if (!kind) throw createHttpError(400, "Say whether this is an add-on option or a size.");
    const key = kind === "option"
      ? { groupName: text(req.body.groupName, 120), optionName: text(req.body.optionName, 120), menuItemId: null, variantName: "" }
      : { groupName: "", optionName: "", menuItemId: oid(req.body.menuItemId), variantName: text(req.body.variantName, 120) };
    if (kind === "option" ? !key.groupName || !key.optionName : !key.variantName) throw createHttpError(400, "Which add-on is this?");
    const ingredients = await cleanRecipeLines(s.restaurantId, req.body?.ingredients || []);
    const filter = { restaurantId: s.restaurantId, kind, ...key };
    if (!ingredients.length) {
      await AddonRecipe.deleteOne(filter);
      return res.status(200).json({ success: true, data: null });
    }
    const doc = await AddonRecipe.findOneAndUpdate(filter, { $set: { ingredients } }, { new: true, upsert: true });
    res.status(200).json({ success: true, data: doc });
  } catch (e) { next(e); }
};

/* ------------------------------------------------------------ stock count */

/** A count's totals: items counted, and the ₹ of what was missing and over. */
const countTotals = (lines = []) => {
  let missing = 0;
  let extra = 0;
  let counted = 0;
  for (const l of lines) {
    if (l.counted === null || l.counted === undefined) continue;
    counted += 1;
    const v = (Number(l.counted) - Number(l.expected)) * (Number(l.costPerUnit) || 0);
    if (v < 0) missing += -v;
    else extra += v;
  }
  return { counted, missing: Math.round(missing * 100) / 100, extra: Math.round(extra * 100) / 100 };
};

/** A count as the screens read it; an open one shows each item's stock now as expected. */
const countView = async (count, restaurantId) => {
  const o = count.toObject ? count.toObject() : count;
  if (o.status === "open") {
    const live = new Map((await Ingredient.find({ restaurantId, isDeleted: { $ne: true } }).select("_id stockQuantity costPerUnit").lean()).map((i) => [String(i._id), i]));
    o.lines = o.lines.map((l) => ({ ...l, expected: round3(live.get(String(l.ingredientId))?.stockQuantity), costPerUnit: Number(live.get(String(l.ingredientId))?.costPerUnit) || 0 }));
  }
  return { ...o, totals: countTotals(o.lines) };
};

const listCounts = async (req, res, next) => {
  try {
    const s = scope(req);
    const rows = await StockCount.find({ restaurantId: s.restaurantId, status: { $ne: "cancelled" } }).sort({ number: -1 }).limit(30).lean();
    res.status(200).json({
      success: true,
      data: rows.map((c) => ({ _id: c._id, number: c.number, status: c.status, createdAt: c.createdAt, finishedAt: c.finishedAt, items: c.lines.length, totals: countTotals(c.lines) })),
    });
  } catch (e) { next(e); }
};

/** Start a count of every item, or carry on with the one already open. */
const startCount = async (req, res, next) => {
  try {
    const s = scope(req);
    let count = await StockCount.findOne({ restaurantId: s.restaurantId, status: "open" });
    if (!count) {
      const items = await Ingredient.find(s).sort({ category: 1, name: 1 }).lean();
      if (!items.length) throw createHttpError(400, "Add inventory items before counting them.");
      const last = await StockCount.findOne({ restaurantId: s.restaurantId }).sort({ number: -1 }).select("number").lean();
      count = await StockCount.create({
        restaurantId: s.restaurantId, number: (last?.number || 0) + 1, startedBy: req.user._id,
        lines: items.map((i) => ({ ingredientId: i._id, name: i.name, unit: i.unit, category: i.category, counted: null })),
      });
    }
    res.status(201).json({ success: true, data: await countView(count, s.restaurantId) });
  } catch (e) { next(e); }
};

const getCount = async (req, res, next) => {
  try {
    const s = scope(req);
    const count = await StockCount.findOne({ _id: oid(req.params.id), restaurantId: s.restaurantId });
    if (!count) throw createHttpError(404, "Count not found.");
    res.status(200).json({ success: true, data: await countView(count, s.restaurantId) });
  } catch (e) { next(e); }
};

/** Save what has been counted so far (a count can take a while, on several phones). */
const saveCount = async (req, res, next) => {
  try {
    const s = scope(req);
    const count = await StockCount.findOne({ _id: oid(req.params.id), restaurantId: s.restaurantId, status: "open" });
    if (!count) throw createHttpError(404, "No open count.");
    const given = new Map((Array.isArray(req.body?.lines) ? req.body.lines : []).map((l) => [String(l?.ingredientId), l?.counted]));
    for (const line of count.lines) {
      if (!given.has(String(line.ingredientId))) continue;
      const v = given.get(String(line.ingredientId));
      line.counted = v === null || v === "" || v === undefined ? null : round3(num(v, { min: 0, max: 1e7 }) ?? 0);
    }
    if (req.body?.note !== undefined) count.note = text(req.body.note, 300);
    await count.save();
    res.status(200).json({ success: true, data: await countView(count, s.restaurantId) });
  } catch (e) { next(e); }
};

/**
 * Finish: every counted item is set to what was counted; the difference from
 * the stock at this moment is recorded as a "count" movement, in quantity and
 * ₹. Items left blank are not touched.
 */
const finishCount = async (req, res, next) => {
  try {
    const s = scope(req);
    const count = await StockCount.findOneAndUpdate(
      { _id: oid(req.params.id), restaurantId: s.restaurantId, status: "open" },
      { $set: { status: "done", finishedAt: new Date(), finishedBy: req.user._id } },
      { new: true },
    );
    if (!count) throw createHttpError(404, "No open count.");
    for (const line of count.lines) {
      const ing = await Ingredient.findOne({ _id: line.ingredientId, ...s });
      if (!ing) continue;
      line.expected = round3(ing.stockQuantity);
      line.costPerUnit = Number(ing.costPerUnit) || 0;
      if (line.counted === null || line.counted === undefined) continue;
      const diff = round3(line.counted - line.expected);
      if (diff === 0) continue;
      ing.stockQuantity = round3(line.counted);
      if (diff < 0 && (ing.batches || []).length) ing.batches = trimBatches(ing.batches, ing.stockQuantity);
      refreshFlag(ing);
      await ing.save();
      await StockMovement.create({
        restaurantId: s.restaurantId, outletId: req.user.outletId || undefined, ingredientId: ing._id, ingredientName: ing.name,
        type: "count", quantity: diff, value: worth(ing, diff), unit: ing.unit, reason: `Stock count #${count.number}`,
        referenceId: String(count._id), createdBy: req.user._id,
      });
    }
    await count.save();
    const totals = countTotals(count.lines);
    await logActivity({ req, action: "Stock Count", resource: "Inventory", resourceId: count._id,
      newValue: `#${count.number}`, description: `Stock count #${count.number}: ${totals.counted} item(s), ₹${totals.missing} missing, ₹${totals.extra} over` });
    emit(s.restaurantId, "inventory:stock", {});
    res.status(200).json({ success: true, data: await countView(count, s.restaurantId) });
  } catch (e) { next(e); }
};

const cancelCount = async (req, res, next) => {
  try {
    const s = scope(req);
    const count = await StockCount.findOneAndUpdate({ _id: oid(req.params.id), restaurantId: s.restaurantId, status: "open" }, { $set: { status: "cancelled" } }, { new: true });
    if (!count) throw createHttpError(404, "No open count.");
    res.status(200).json({ success: true });
  } catch (e) { next(e); }
};

/* ---------------------------------------------------------------- reports */

const IST = "Asia/Kolkata";
/** A YYYY-MM-DD day in India as the instant it starts. */
const istDayStart = (day) => new Date(`${day}T00:00:00+05:30`);
const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: IST });

/**
 * Inventory report for a period (owner, 2026-11-01): stock value now, what was
 * used, wasted, bought and found missing in counts, in ₹, and the real food
 * cost: stock used against sales before tax.
 */
const inventoryReport = async (req, res, next) => {
  try {
    const s = scope(req);
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);
    const to = day(req.query.to) || istToday();
    const from = day(req.query.from) || new Date(istDayStart(to).getTime() - 29 * 86400000).toLocaleDateString("en-CA", { timeZone: IST });
    const start = istDayStart(from);
    const end = new Date(istDayStart(to).getTime() + 86400000);
    if (!(start < end) || end - start > 400 * 86400000) throw createHttpError(400, "Pick a period of up to 400 days.");

    const Order = require("../models/orderModel");
    const { netAmount, orderTotal } = require("../services/refunds");
    const [items, moves, orders] = await Promise.all([
      Ingredient.find(s).select("_id name unit category stockQuantity costPerUnit").lean(),
      StockMovement.find({ restaurantId: s.restaurantId, createdAt: { $gte: start, $lt: end } }).select("ingredientId ingredientName type quantity value cost unit reason").lean(),
      Order.find({ restaurantId: s.restaurantId, createdAt: { $gte: start, $lt: end }, isDeleted: { $ne: true } }).select("orderStatus bills refunds paymentData totalAmount").lean(),
    ]);
    const byId = new Map(items.map((i) => [String(i._id), i]));
    // Movements from before values were recorded are valued at today's cost price.
    const valueOf = (m) => (m.value ? Number(m.value) : (Number(m.quantity) || 0) * (Number(byId.get(String(m.ingredientId))?.costPerUnit) || 0));

    const per = new Map();
    const bucket = (m) => {
      const k = String(m.ingredientId);
      if (!per.has(k)) per.set(k, { ingredientId: k, name: m.ingredientName, unit: byId.get(k)?.unit || m.unit, used: 0, usedValue: 0, wasted: 0, wastedValue: 0, bought: 0, boughtValue: 0, countDiff: 0, countValue: 0 });
      return per.get(k);
    };
    for (const m of moves) {
      const b = bucket(m);
      const q = Number(m.quantity) || 0;
      const v = valueOf(m);
      // A cancelled order's stock put back is a sale undone.
      if (m.type === "sale" || m.type === "return") { b.used += -q; b.usedValue += -v; }
      else if (m.type === "waste") { b.wasted += -q; b.wastedValue += -v; }
      else if (m.type === "purchase") { b.bought += q; b.boughtValue += Number(m.value) || Number(m.cost) || v; }
      else if (m.type === "count" || (m.type === "adjustment" && m.reason !== "Opening stock")) { b.countDiff += q; b.countValue += v; }
    }
    const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
    const rows = [...per.values()].map((b) => ({
      ...b, used: round3(b.used), usedValue: r2(b.usedValue), wasted: round3(b.wasted), wastedValue: r2(b.wastedValue),
      bought: round3(b.bought), boughtValue: r2(b.boughtValue), countDiff: round3(b.countDiff), countValue: r2(b.countValue),
    }));
    const sum = (k) => r2(rows.reduce((n, r) => n + r[k], 0));

    // Sales before tax: what an order took after refunds, less its share of tax.
    let sales = 0;
    for (const o of orders) {
      const net = netAmount(o);
      if (!(net > 0)) continue;
      const total = orderTotal(o) || net;
      const tax = Number(o.bills?.tax) || 0;
      sales += net * (total > 0 ? Math.max(0, 1 - tax / total) : 1);
    }
    sales = r2(sales);
    const used = sum("usedValue");
    const settings = await settingsOf(s.restaurantId);
    res.status(200).json({
      success: true,
      data: {
        from, to,
        stockValue: r2(items.reduce((n, i) => n + Math.max(0, Number(i.stockQuantity) || 0) * (Number(i.costPerUnit) || 0), 0)),
        used, wasted: sum("wastedValue"), bought: sum("boughtValue"), countDifference: sum("countValue"),
        sales, foodCostPct: sales > 0 ? Math.round((used / sales) * 1000) / 10 : null,
        targetFoodCostPct: settings.targetFoodCostPct,
        items: rows.sort((a, b) => b.usedValue - a.usedValue),
        noCostPrice: items.filter((i) => !(Number(i.costPerUnit) > 0)).map((i) => i.name),
      },
    });
  } catch (e) { next(e); }
};

/* --------------------------------------------------------------- settings */

const getSettings = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await settingsOf(scope(req).restaurantId) });
  } catch (e) { next(e); }
};

const saveSettings = async (req, res, next) => {
  try {
    const s = scope(req);
    const Restaurant = require("../models/restaurantModel");
    const set = {};
    const pct = num(req.body?.targetFoodCostPct, { min: 1, max: 100 });
    if (pct !== null) set["inventorySettings.targetFoodCostPct"] = Math.round(pct);
    const days = num(req.body?.expiryAlertDays, { min: 0, max: 60 });
    if (days !== null) set["inventorySettings.expiryAlertDays"] = Math.round(days);
    const minutes = num(req.body?.cancelReturnMinutes, { min: 0, max: 1440 });
    if (minutes !== null) set["inventorySettings.cancelReturnMinutes"] = Math.round(minutes);
    if (Object.keys(set).length) await Restaurant.updateOne({ _id: s.restaurantId }, { $set: set });
    res.status(200).json({ success: true, data: await settingsOf(s.restaurantId) });
  } catch (e) { next(e); }
};

module.exports = {
  makeBatch, dishCosts, listAddonRecipes, saveAddonRecipe,
  listCounts, startCount, getCount, saveCount, finishCount, cancelCount,
  inventoryReport, getSettings, saveSettings,
  listIngredients, listRestockAlerts, createIngredient, updateIngredient, deleteIngredient,
  recordMovement, listMovements, listRecipes, upsertRecipe, deleteRecipe,
  stockAvailability, turnOffProducts, answerBack,
};
