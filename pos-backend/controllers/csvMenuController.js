const Menu = require("../models/menuModel");
const MenuGroup = require("../models/menuGroupModel");
const createHttpError = require("http-errors");
const { attachedGroup } = require("../services/modifierGroups");

/**
 * Menu tenancy scope.
 *
 * A takeaway's menus, categories, products, groups and every menu setting
 * belong to that takeaway ALONE. This helper is the single chokepoint every
 * menu read and write goes through, so it is the one place that guarantees it.
 *
 * It used to be an $or -- restaurantId OR createdBy -- to keep single-user
 * legacy installs working. That is a UNION, not a fallback: whoever created
 * menus for two takeaways then saw both sets merged into one. Because every
 * group operation keys off the group NAME across every menu in scope
 * (rename / delete / toggle-active / reorder), renaming "Sauce" in one
 * takeaway renamed it in the other, and a CSV "replace all" could delete the
 * other takeaway's menus outright.
 *
 * createdBy is now only a FALLBACK, for a user with no restaurantId at all --
 * matching tenantScopeFor() in orderController. Staff still reach menus their
 * owner created, because they share the restaurantId.
 *
 * outletId is deliberately NOT part of this scope: menus are store-wide and no
 * menu carries an outletId. Adding the clause would hide every existing menu
 * the moment anyone set a user's outletId.
 */
const { userScope: menuScopeFor } = require("../services/tenantContext");

const STANDARD_HEADERS = ["Category", "Subcategory", "Item Name", "Description", "Veg/Non-Veg", "Price", "Groups"];

/*
 * Modifier groups travel in the same file (owner, 2026-10-29: the CSV used to
 * leave them out, so an import wiped every product's groups):
 *
 *   - each product row lists its groups, in order, in a "Groups" column:
 *     "Extra Toppings | Crust";
 *   - under the products, a second table defines every group of the store,
 *     one option per row:
 *       Group,Option,Option Price,Required,Max Selections,Active
 *     Max Selections blank means no limit.
 *
 * A CSV without the Groups column (an older file) keeps each product's groups
 * as they are. A product naming a group that neither the file nor Manage Menu
 * has is refused, before anything is replaced.
 */
const GROUP_HEADERS = ["Group", "Option", "Option Price", "Required", "Max Selections", "Active"];
const GROUP_SEPARATOR = "|";

const YES = ["yes", "y", "true", "1", "on"];
const NO = ["no", "n", "false", "0", "off"];
const yes = (v, fallback) => {
  const t = String(v ?? "").trim().toLowerCase();
  return t ? YES.includes(t) : fallback;
};
const yesNoValid = (v) => {
  const t = String(v ?? "").trim().toLowerCase();
  return !t || YES.includes(t) || NO.includes(t);
};

/** The product rows and the group rows (from the "Group,Option,..." header on). */
const splitSections = (rows) => {
  const at = rows.findIndex(
    (r) => String(r[0] || "").trim().toLowerCase() === "group" && r.some((c) => String(c).toLowerCase().includes("option")),
  );
  return at === -1 ? { productRows: rows, groupRows: [] } : { productRows: rows.slice(0, at), groupRows: rows.slice(at) };
};

/**
 * The group table into { name -> group }. A group's rules come from its first
 * row; later rows add options. Row numbers continue from the product rows.
 */
const parseGroupSection = (groupRows, rowsAbove) => {
  const groups = new Map();
  const errors = [];
  if (!groupRows.length) return { groups, errors };
  const head = groupRows[0].map((h) => String(h).toLowerCase());
  const col = (test) => head.findIndex(test);
  const gIdx = col((h) => h.trim() === "group");
  const oIdx = col((h) => h.includes("option") && !h.includes("price"));
  const pIdx = col((h) => h.includes("price"));
  const rIdx = col((h) => h.includes("required"));
  const mIdx = col((h) => h.includes("max"));
  const aIdx = col((h) => h.includes("active"));
  const cell = (row, idx) => (idx === -1 ? "" : String(row[idx] ?? "").trim());
  for (let i = 1; i < groupRows.length; i++) {
    const row = groupRows[i];
    const at = "Row " + (rowsAbove + i + 1) + ": ";
    const name = cell(row, gIdx);
    if (!name) {
      if (row.some((c) => String(c).trim())) errors.push(at + "Group name is required.");
      continue;
    }
    const option = cell(row, oIdx);
    const priceText = cell(row, pIdx);
    const price = priceText === "" ? 0 : Number(priceText);
    if (!Number.isFinite(price) || price < 0) errors.push(at + 'Invalid option price "' + priceText + '". Must be numeric and non-negative.');
    const maxText = cell(row, mIdx);
    const max = Number(maxText);
    const maxOk = Number.isInteger(max) && max >= 1;
    if (maxText && !maxOk) errors.push(at + "Max Selections must be a whole number of 1 or more, or blank for no limit.");
    if (!yesNoValid(cell(row, rIdx))) errors.push(at + "Required must be Yes or No.");
    if (!yesNoValid(cell(row, aIdx))) errors.push(at + "Active must be Yes or No.");
    let g = groups.get(name);
    if (!g) {
      g = {
        name,
        required: yes(cell(row, rIdx), false),
        maxSelectionEnabled: Boolean(maxText),
        maxSelections: maxText && maxOk ? max : 1,
        isActive: yes(cell(row, aIdx), true),
        options: [],
      };
      groups.set(name, g);
    }
    if (option && !g.options.some((o) => o.name === option)) {
      g.options.push({ name: option, price: Number.isFinite(price) && price >= 0 ? price : 0 });
    }
  }
  for (const g of groups.values()) {
    // A required group with nothing to pick makes its products unorderable everywhere.
    if (g.required && !g.options.length) errors.push('Group "' + g.name + '": a required group needs at least one option.');
  }
  return { groups, errors };
};

/** The groups a product row names, in order, without repeats. */
const groupNames = (value) => {
  const out = [];
  for (const n of String(value || "").split(GROUP_SEPARATOR).map((x) => x.trim()).filter(Boolean)) {
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

/**
 * Everything an import needs about groups, checked before anything changes:
 * the definitions (the file's, else the store's list, else as a product
 * carries it) and every product row's group names.
 */
const planGroups = async (scope, productRows, groupRows) => {
  const { groups: fileGroups, errors } = parseGroupSection(groupRows, productRows.length);
  const header = (productRows[0] || []).map((h) => String(h).toLowerCase());
  const groupsIdx = header.findIndex((h) => h.includes("group"));
  const nameIdx = header.findIndex((h) => h.includes("item") || h.includes("product") || h === "name");
  const known = new Map();
  for (const row of await MenuGroup.find(scope).lean()) known.set(row.name, row);
  const menus = await Menu.find(scope).select("name items.name items.modifierGroups").lean();
  for (const item of menus.flatMap((m) => m.items || [])) {
    for (const g of item.modifierGroups || []) if (!known.has(g.name)) known.set(g.name, g);
  }
  for (const [name, g] of fileGroups) known.set(name, g);
  if (groupsIdx !== -1) {
    for (let i = 1; i < productRows.length; i++) {
      for (const n of groupNames(productRows[i][groupsIdx])) {
        if (!known.has(n)) {
          errors.push("Row " + (i + 1) + ': Group "' + n + '" for "' + (productRows[i][nameIdx] || "") + '" is not in the Groups table or in Manage Menu.');
        }
      }
    }
  }
  return { fileGroups, known, groupsIdx, menus, errors };
};

const csvEscape = (val) => {
  const s = String(val || "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

const parseCsvLines = (text) => {
  const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const parseRow = (line) => {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  // A row of nothing but commas (Excel saves the blank line above the groups
  // table that way) is a blank line too.
  return lines.map(parseRow).filter((fields) => fields.some((f) => f !== ""));
};

/**
 * GET /api/menu/csv/export — Export menu to CSV
 */
const exportCsv = async (req, res, next) => {
  try {
    const menus = await Menu.find({
      ...menuScopeFor(req.user),
      isDeleted: { $ne: true },
    }).sort({ createdAt: 1 });

    const rows = [STANDARD_HEADERS.join(",")];
    const library = await MenuGroup.find(menuScopeFor(req.user)).sort({ sortOrder: 1, name: 1 }).lean();
    const defined = new Map(library.map((g) => [g.name, g]));
    const ordered = (item) => [...(item.modifierGroups || [])].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    for (const menu of menus) {
      for (const item of menu.items || []) {
        // A group older than the store's list still gets a definition below.
        for (const g of ordered(item)) if (!defined.has(g.name)) defined.set(g.name, g);
        const category = menu.name;
        const subcategory = item.subcategory || "";
        const itemName = item.name;
        const description = item.description || "";
        const veg = item.isVegetarian !== false ? "Veg" : "Non-Veg";
        const price = item.price ?? 0;

        rows.push(
          [
            csvEscape(category),
            csvEscape(subcategory),
            csvEscape(itemName),
            csvEscape(description),
            veg,
            price,
            csvEscape(ordered(item).map((g) => g.name).join(" " + GROUP_SEPARATOR + " ")),
          ].join(",")
        );
      }
    }

    // The groups, one option per row, under a blank line.
    rows.push("", GROUP_HEADERS.join(","));
    for (const g of defined.values()) {
      const rules = [
        g.required ? "Yes" : "No",
        g.maxSelectionEnabled === true ? Math.max(1, Number(g.maxSelections) || 1) : "",
        g.isActive === false ? "No" : "Yes",
      ];
      const options = (g.options || []).length ? g.options : [{ name: "", price: "" }];
      for (const o of options) rows.push([csvEscape(g.name), csvEscape(o.name), o.price ?? "", ...rules].join(","));
    }

    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", 'attachment; filename="knotkitchen_menu.csv"');
    res.status(200).send(rows.join("\n"));
  } catch (error) {
    next(error);
  }
};

/**
 * Validate CSV rows and return validation errors if any
 */
const validateCsvRows = (rows) => {
  const errors = [];
  if (!rows || rows.length < 2) {
    return ["CSV file is empty or missing content rows."];
  }

  const headerRow = rows[0].map((h) => h.toLowerCase());
  const catIdx = headerRow.findIndex((h) => h.includes("category"));
  const subIdx = headerRow.findIndex((h) => h.includes("sub"));
  const nameIdx = headerRow.findIndex((h) => h.includes("item") || h.includes("product") || h === "name");
  const descIdx = headerRow.findIndex((h) => h.includes("desc"));
  const vegIdx = headerRow.findIndex((h) => h.includes("veg"));
  const priceIdx = headerRow.findIndex((h) => h.includes("price"));

  if (catIdx === -1 || nameIdx === -1 || priceIdx === -1 || vegIdx === -1) {
    return [
      `Invalid CSV Header. Headers must include: Category, Subcategory, Item Name, Description, Veg/Non-Veg, Price`,
    ];
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lineNum = i + 1;
    if (row.length === 0 || (row.length === 1 && !row[0])) continue; // ignore empty rows

    const category = row[catIdx];
    const itemName = row[nameIdx];
    const vegVal = row[vegIdx];
    const priceVal = row[priceIdx];

    if (!category || !category.trim()) {
      errors.push(`Row ${lineNum}: Category is required.`);
    }

    if (!itemName || !itemName.trim()) {
      errors.push(`Row ${lineNum}: Item Name is required.`);
    }

    if (!vegVal || !vegVal.trim()) {
      errors.push(`Row ${lineNum}: Veg/Non-Veg is required.`);
    } else {
      const v = vegVal.trim().toLowerCase();
      if (v !== "veg" && v !== "non-veg" && v !== "vegetarian" && v !== "non-vegetarian") {
        errors.push(`Row ${lineNum}: Invalid Veg/Non-Veg value "${vegVal}". Allowed: Veg or Non-Veg.`);
      }
    }

    if (priceVal === undefined || priceVal === null || priceVal.trim() === "") {
      errors.push(`Row ${lineNum}: Price is required.`);
    } else {
      const numP = Number(priceVal.trim());
      if (!Number.isFinite(numP) || numP < 0) {
        errors.push(`Row ${lineNum}: Invalid price "${priceVal}". Must be numeric and non-negative.`);
      }
    }
  }

  return errors;
};

/**
 * POST /api/menu/csv/preview — Validate CSV & return preview summary
 */
const previewCsvImport = async (req, res, next) => {
  try {
    const { csvText } = req.body || {};
    if (!csvText) return next(createHttpError(400, "CSV content is required!"));

    const { productRows: rows, groupRows } = splitSections(parseCsvLines(csvText));
    const errors = validateCsvRows(rows);
    const plan = errors.length ? null : await planGroups(menuScopeFor(req.user), rows, groupRows);
    if (plan) errors.push(...plan.errors);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "CSV validation failed",
        errors: errors.slice(0, 20),
      });
    }

    const headerRow = rows[0].map((h) => h.toLowerCase());
    const catIdx = headerRow.findIndex((h) => h.includes("category"));
    const subIdx = headerRow.findIndex((h) => h.includes("sub"));
    const nameIdx = headerRow.findIndex((h) => h.includes("item") || h.includes("product") || h === "name");
    const usedGroups = new Set();
    if (plan.groupsIdx !== -1) {
      for (let i = 1; i < rows.length; i++) for (const n of groupNames(rows[i][plan.groupsIdx])) usedGroups.add(n);
    }
    const listedGroups = new Set([...plan.fileGroups.keys(), ...usedGroups]);

    const categoriesSet = new Set();
    const subcategoriesSet = new Set();
    const productsSet = new Set();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const cat = row[catIdx]?.trim();
      const sub = subIdx !== -1 ? row[subIdx]?.trim() : "";
      const name = row[nameIdx]?.trim();

      if (cat) categoriesSet.add(cat);
      if (sub && cat) subcategoriesSet.add(`${cat}>${sub}`);
      if (name && cat) productsSet.add(`${cat}>${name}`);
    }

    res.status(200).json({
      success: true,
      data: {
        categoriesCount: categoriesSet.size,
        subcategoriesCount: subcategoriesSet.size,
        productsCount: productsSet.size,
        totalRows: rows.length - 1,
        // The preview's "Groups (Extras)" line: the groups in the file and their options.
        groupsCount: listedGroups.size,
        extrasCount: [...listedGroups].reduce((n, name) => n + (plan.known.get(name)?.options || []).length, 0),
        groupsKept: plan.groupsIdx === -1,
        warning: "This import will update/replace the active menu structure. Historical orders remain safe.",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/menu/csv/import — Transactional CSV Import / Replacement
 */
const confirmCsvImport = async (req, res, next) => {
  try {
    const { csvText } = req.body || {};
    if (!csvText) return next(createHttpError(400, "CSV content is required!"));

    const { productRows: rows, groupRows } = splitSections(parseCsvLines(csvText));
    const errors = validateCsvRows(rows);
    const scope = menuScopeFor(req.user);
    const plan = errors.length ? null : await planGroups(scope, rows, groupRows);
    if (plan) errors.push(...plan.errors);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "CSV validation failed",
        errors: errors.slice(0, 20),
      });
    }

    // Each product's groups: the ones its row names, in that order, built
    // from the file's definition (or the store's). With no Groups column at
    // all (an older file) a product keeps the groups it has now.
    const lower = (v) => String(v || "").trim().toLowerCase();
    const keptGroups = new Map();
    for (const m of plan.menus) {
      for (const it of m.items || []) {
        if (!(it.modifierGroups || []).length) continue;
        keptGroups.set(lower(m.name) + "|" + lower(it.name), it.modifierGroups);
        if (!keptGroups.has(lower(it.name))) keptGroups.set(lower(it.name), it.modifierGroups);
      }
    }
    const withoutId = ({ _id, ...rest }) => rest; // eslint-disable-line no-unused-vars
    const groupsFor = (row, categoryName, itemName) => {
      if (plan.groupsIdx === -1) {
        const kept = keptGroups.get(lower(categoryName) + "|" + lower(itemName)) || keptGroups.get(lower(itemName)) || [];
        return kept.map((g) => ({ ...withoutId(g), options: (g.options || []).map(withoutId) }));
      }
      return groupNames(row[plan.groupsIdx]).map((n, i) => ({ ...attachedGroup(n, {}, plan.known.get(n)), sortOrder: i }));
    };

    const headerRow = rows[0].map((h) => h.toLowerCase());
    const catIdx = headerRow.findIndex((h) => h.includes("category"));
    const subIdx = headerRow.findIndex((h) => h.includes("sub"));
    const nameIdx = headerRow.findIndex((h) => h.includes("item") || h.includes("product") || h === "name");
    const descIdx = headerRow.findIndex((h) => h.includes("desc"));
    const vegIdx = headerRow.findIndex((h) => h.includes("veg"));
    const priceIdx = headerRow.findIndex((h) => h.includes("price"));

    // Photos stay with their items. The CSV has no image column and the
    // import rebuilds the menu, so without this every photo was lost on an
    // import. An item whose name is unchanged keeps its photo: matched by
    // category + name first, then by name alone (it moved category).
    const nameKey = (s) => String(s || "").trim().toLowerCase();
    const photoOf = new Map();
    const current = await Menu.find({ ...menuScopeFor(req.user) })
      .select("name items._id items.name items.image items.imageId items.imageUrl items.imageThumbnailUrl items.imageAlt")
      .lean();
    // So does its id: inventory recipes (and a product turned off for want of
    // stock) point at the item's _id, and an import that gave every product a
    // new one left every recipe pointing at nothing, so sales stopped taking
    // stock off. Matched like the photo; each old id is used once.
    const idOf = new Map();
    for (const m of current) {
      for (const it of m.items || []) {
        if (!it._id) continue;
        idOf.set(`${nameKey(m.name)}|${nameKey(it.name)}`, it._id);
        if (!idOf.has(nameKey(it.name))) idOf.set(nameKey(it.name), it._id);
      }
    }
    const usedIds = new Set();
    const keepId = (categoryName, itemName) => {
      const id = idOf.get(`${nameKey(categoryName)}|${nameKey(itemName)}`) || idOf.get(nameKey(itemName));
      if (!id || usedIds.has(String(id))) return {};
      usedIds.add(String(id));
      return { _id: id };
    };
    for (const m of current) {
      for (const it of m.items || []) {
        if (!it.imageUrl && !it.image) continue;
        const photo = {
          image: it.image || "",
          imageId: it.imageId || null,
          imageUrl: it.imageUrl || "",
          imageThumbnailUrl: it.imageThumbnailUrl || "",
          imageAlt: it.imageAlt || "",
        };
        photoOf.set(`${nameKey(m.name)}|${nameKey(it.name)}`, photo);
        if (!photoOf.has(nameKey(it.name))) photoOf.set(nameKey(it.name), photo);
      }
    }

    // Parse all menu categories and items into memory structure first (Transactional safety)
    const menusMap = new Map(); // CategoryName -> { subcategoriesSet: Set(), itemsMap: Map() }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (row.length === 0 || (row.length === 1 && !row[0])) continue;

      const categoryName = row[catIdx]?.trim();
      const subcategoryName = subIdx !== -1 ? row[subIdx]?.trim() || "" : "";
      const itemName = row[nameIdx]?.trim();
      const description = descIdx !== -1 ? row[descIdx]?.trim() || "" : "";
      const vegRaw = row[vegIdx]?.trim().toLowerCase();
      const isVeg = vegRaw === "veg" || vegRaw === "vegetarian";
      const priceNum = Math.max(0, Number(row[priceIdx]?.trim()) || 0);

      if (!categoryName || !itemName) continue;

      let menuEntry = menusMap.get(categoryName);
      if (!menuEntry) {
        menuEntry = {
          name: categoryName,
          subcategoriesSet: new Set(),
          itemsMap: new Map(),
        };
        menusMap.set(categoryName, menuEntry);
      }

      if (subcategoryName) {
        menuEntry.subcategoriesSet.add(subcategoryName);
      }

      menuEntry.itemsMap.set(itemName, {
        ...keepId(categoryName, itemName),
        name: itemName,
        price: priceNum,
        category: categoryName,
        subcategory: subcategoryName,
        description,
        isVegetarian: isVeg,
        dispatchType: { collection: true, delivery: true, table: true },
        isAvailable: true,
        modifierGroups: groupsFor(row, categoryName, itemName),
        ...(photoOf.get(`${nameKey(categoryName)}|${nameKey(itemName)}`) || photoOf.get(nameKey(itemName)) || {}),
      });
    }

    // Replace active menu safely for the store without touching historical orders or other collections
    await Menu.deleteMany({ ...menuScopeFor(req.user) });

    let createdCategories = 0;
    let createdProducts = 0;

    for (const [, menuEntry] of menusMap) {
      const subcategories = Array.from(menuEntry.subcategoriesSet).map((subName) => ({
        name: subName,
        description: "",
        dispatchType: { collection: true, delivery: true, table: true },
        bgColor: "#0249fd",
        textColor: "#ffffff",
      }));

      const items = Array.from(menuEntry.itemsMap.values());

      const newMenu = new Menu({
        name: menuEntry.name,
        subcategories,
        items,
        createdBy: req.user._id,
        restaurantId: req.user?.restaurantId,
        outletId: req.user?.outletId,
        bgColor: "#0249fd",
      });

      await newMenu.save();
      createdCategories++;
      createdProducts += items.length;
    }

    // The file's groups into the store's list (Manage Menu's Groups tab),
    // created or updated by name. Groups the file leaves out stay as they are.
    let groupCount = await MenuGroup.countDocuments(scope);
    for (const g of plan.fileGroups.values()) {
      const fields = {
        required: g.required,
        maxSelectionEnabled: g.maxSelectionEnabled,
        maxSelections: g.maxSelections,
        isActive: g.isActive,
        options: g.options,
      };
      const exists = await MenuGroup.exists({ ...scope, name: g.name });
      await MenuGroup.updateOne(
        { ...scope, name: g.name },
        exists ? { $set: fields } : { $set: fields, $setOnInsert: { sortOrder: groupCount++ } },
        { upsert: true },
      );
    }

    // An import lands in the DRAFT and stops there.
    //
    // This used to call publishAllMenusForUser for "system" and "website"
    // right here, so a CSV went live on the tills and the website the
    // instant it was uploaded, with no chance to check it. Worse, it
    // published EVERY menu the user owns, not just the imported ones, so an
    // import also pushed out unrelated edits that were still being worked
    // on. Publishing is the operator's decision, taken in Manage Cache.
    res.status(200).json({
      success: true,
      message:
        `Imported ${createdCategories} categories, ${createdProducts} products and ${plan.fileGroups.size} groups into your draft menu. ` +
        `Publish from Manage Cache to make them live on the POS and website.`,
      data: { createdCategories, createdProducts, groups: plan.fileGroups.size, published: false },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Exposed for tests: takeaway isolation lives or dies on this helper.
  __menuScopeForTest: menuScopeFor,
  __csvForTest: { parseCsvLines, splitSections, parseGroupSection, groupNames },
  exportCsv,
  previewCsvImport,
  confirmCsvImport,
};
