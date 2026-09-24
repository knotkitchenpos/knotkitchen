const Menu = require("../models/menuModel");
const createHttpError = require("http-errors");

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

const STANDARD_HEADERS = ["Category", "Subcategory", "Item Name", "Description", "Veg/Non-Veg", "Price"];

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

  return lines.map(parseRow);
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

    for (const menu of menus) {
      for (const item of menu.items || []) {
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
          ].join(",")
        );
      }
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

    const rows = parseCsvLines(csvText);
    const errors = validateCsvRows(rows);

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

    const rows = parseCsvLines(csvText);
    const errors = validateCsvRows(rows);

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
      .select("name items.name items.image items.imageId items.imageUrl items.imageThumbnailUrl items.imageAlt")
      .lean();
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
        name: itemName,
        price: priceNum,
        category: categoryName,
        subcategory: subcategoryName,
        description,
        isVegetarian: isVeg,
        dispatchType: { collection: true, delivery: true, table: true },
        isAvailable: true,
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
        `Imported ${createdCategories} categories and ${createdProducts} products into your draft menu. ` +
        `Publish from Manage Cache to make them live on the POS and website.`,
      data: { createdCategories, createdProducts, published: false },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  // Exposed for tests: takeaway isolation lives or dies on this helper.
  __menuScopeForTest: menuScopeFor,
  exportCsv,
  previewCsvImport,
  confirmCsvImport,
};
