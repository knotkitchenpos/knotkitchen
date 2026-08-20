const Menu = require("../models/menuModel");
const createHttpError = require("http-errors");

const menuScopeFor = (user) => {
  if (user?.restaurantId) {
    const clauses = [{ restaurantId: user.restaurantId }];
    if (user._id) clauses.push({ createdBy: user._id });
    return { $or: clauses };
  }
  return { createdBy: user?._id };
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * GET /api/menu/csv/export — Export menu to CSV (Module 5 §1)
 */
const exportCsv = async (req, res, next) => {
  try {
    const menus = await Menu.find({
      ...menuScopeFor(req.user),
      isDeleted: { $ne: true },
    }).sort({ createdAt: 1 });

    const headers = [
      "Main Category",
      "Subcategory",
      "Product Name",
      "Description",
      "Collection Enabled",
      "Delivery Enabled",
      "Table Enabled",
      "Same Price",
      "POS Collection Price",
      "POS Delivery Price",
      "POS Table Price",
      "Website Collection Price",
      "Website Delivery Price",
      "Website Table Price",
      "Veg/Non-Veg",
      "Display Target",
      "Availability Days",
      "Product Status",
      "Product Position",
      "Group Name",
      "Extra Name",
      "Extra Price",
    ];

    const rows = [headers.join(",")];

    for (const menu of menus) {
      for (const item of menu.items || []) {
        const colEn = item.dispatchType?.collection !== false;
        const delEn = item.dispatchType?.delivery !== false;
        const tblEn = item.dispatchType?.table !== false;
        const sameP = item.samePrice !== false;
        const cp = item.channelPrices || {};
        const posColP = sameP ? item.price : cp.posCollection ?? item.price;
        const posDelP = sameP ? item.price : cp.posDelivery ?? item.price;
        const posTblP = sameP ? item.price : cp.posTable ?? item.price;
        const webColP = sameP ? item.price : cp.websiteCollection ?? item.price;
        const webDelP = sameP ? item.price : cp.websiteDelivery ?? item.price;
        const webTblP = sameP ? item.price : cp.websiteTable ?? item.price;
        const veg = item.isVegetarian !== false ? "Veg" : "Non-Veg";
        const display = item.displayTarget || "both";
        const days = Array.isArray(item.schedule?.daysOfWeek)
          ? item.schedule.daysOfWeek.map((d) => DAY_NAMES[d]).join(";")
          : "Mon;Tue;Wed;Thu;Fri;Sat;Sun";
        const status = item.isAvailable !== false ? "available" : "out_of_stock";
        const pos = item.sortOrder || 0;

        const groups = item.modifierGroups || [];
        if (groups.length === 0) {
          rows.push(
            [
              csvEscape(menu.name),
              csvEscape(item.subcategory || ""),
              csvEscape(item.name),
              csvEscape(item.description || ""),
              colEn,
              delEn,
              tblEn,
              sameP,
              posColP,
              posDelP,
              posTblP,
              webColP,
              webDelP,
              webTblP,
              veg,
              display,
              csvEscape(days),
              status,
              pos,
              "",
              "",
              "",
            ].join(",")
          );
        } else {
          for (const g of groups) {
            const opts = g.options || [];
            if (opts.length === 0) {
              rows.push(
                [
                  csvEscape(menu.name),
                  csvEscape(item.subcategory || ""),
                  csvEscape(item.name),
                  csvEscape(item.description || ""),
                  colEn,
                  delEn,
                  tblEn,
                  sameP,
                  posColP,
                  posDelP,
                  posTblP,
                  webColP,
                  webDelP,
                  webTblP,
                  veg,
                  display,
                  csvEscape(days),
                  status,
                  pos,
                  csvEscape(g.name),
                  "",
                  "",
                ].join(",")
              );
            } else {
              for (const opt of opts) {
                rows.push(
                  [
                    csvEscape(menu.name),
                    csvEscape(item.subcategory || ""),
                    csvEscape(item.name),
                    csvEscape(item.description || ""),
                    colEn,
                    delEn,
                    tblEn,
                    sameP,
                    posColP,
                    posDelP,
                    posTblP,
                    webColP,
                    webDelP,
                    webTblP,
                    veg,
                    display,
                    csvEscape(days),
                    status,
                    pos,
                    csvEscape(g.name),
                    csvEscape(opt.name),
                    opt.price || 0,
                  ].join(",")
                );
              }
            }
          }
        }
      }
    }

    res.set("Content-Type", "text/csv");
    res.set("Content-Disposition", 'attachment; filename="knotkitchen_menu.csv"');
    res.status(200).send(rows.join("\n"));
  } catch (error) {
    next(error);
  }
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
  if (lines.length < 2) return [];

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
 * POST /api/menu/csv/preview — Validate CSV & return preview summary (Module 5 §2, §6)
 */
const previewCsvImport = async (req, res, next) => {
  try {
    const { csvText } = req.body || {};
    if (!csvText) return next(createHttpError(400, "CSV content is required!"));

    const rows = parseCsvLines(csvText);
    if (rows.length < 2) return next(createHttpError(400, "CSV file is empty or missing headers!"));

    const errors = [];
    const categoriesSet = new Set();
    const subcategoriesSet = new Set();
    const productsSet = new Set();
    const groupsSet = new Set();
    const extrasSet = new Set();

    for (let idx = 1; idx < rows.length; idx++) {
      const row = rows[idx];
      const lineNum = idx + 1;

      const mainCategory = row[0];
      const subcategory = row[1];
      const productName = row[2];
      const priceStr = row[8] || row[7]; // POS Collection price or same price
      const groupName = row[19];
      const extraName = row[20];
      const extraPriceStr = row[21];

      if (!mainCategory) {
        errors.push(`Row ${lineNum}: Main Category is required.`);
      } else {
        categoriesSet.add(mainCategory);
      }

      if (subcategory) subcategoriesSet.add(`${mainCategory}>${subcategory}`);

      if (!productName) {
        errors.push(`Row ${lineNum}: Product Name is required.`);
      } else {
        productsSet.add(`${mainCategory}>${productName}`);
      }

      const p = Number(priceStr);
      if (priceStr !== undefined && priceStr !== "" && (!Number.isFinite(p) || p < 0)) {
        errors.push(`Row ${lineNum}: Invalid or negative price "${priceStr}".`);
      }

      if (groupName) groupsSet.add(groupName);

      if (extraName) {
        extrasSet.add(`${groupName}>${extraName}`);
        const ep = Number(extraPriceStr);
        if (extraPriceStr !== undefined && extraPriceStr !== "" && (!Number.isFinite(ep) || ep < 0)) {
          errors.push(`Row ${lineNum}: Invalid or negative extra price "${extraPriceStr}".`);
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "CSV validation failed",
        errors: errors.slice(0, 20),
      });
    }

    res.status(200).json({
      success: true,
      data: {
        categoriesCount: categoriesSet.size,
        subcategoriesCount: subcategoriesSet.size,
        productsCount: productsSet.size,
        groupsCount: groupsSet.size,
        extrasCount: extrasSet.size,
        totalRows: rows.length - 1,
        warning: "This import will replace the existing menu completely.",
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/menu/csv/import — Replace menu completely with validated CSV (Module 5 §3, §4, §5)
 */
const confirmCsvImport = async (req, res, next) => {
  try {
    const { csvText } = req.body || {};
    if (!csvText) return next(createHttpError(400, "CSV content is required!"));

    const rows = parseCsvLines(csvText);
    if (rows.length < 2) return next(createHttpError(400, "CSV file is empty or missing headers!"));

    // 1. Transactional validation before modifying anything (Module 5 §4)
    const menusMap = new Map(); // mainCat -> { name, items: Map() }

    for (let idx = 1; idx < rows.length; idx++) {
      const row = rows[idx];
      const mainCatName = row[0];
      const subcategory = row[1] || "";
      const prodName = row[2];
      const description = row[3] || "";
      const colEn = row[4] !== "false";
      const delEn = row[5] !== "false";
      const tblEn = row[6] !== "false";
      const sameP = row[7] !== "false";
      const posColP = Number(row[8]) || Number(row[7]) || 0;
      const posDelP = Number(row[9]) || posColP;
      const posTblP = Number(row[10]) || posColP;
      const webColP = Number(row[11]) || posColP;
      const webDelP = Number(row[12]) || posColP;
      const webTblP = Number(row[13]) || posColP;
      const isVeg = (row[14] || "").toLowerCase() !== "non-veg";
      const displayTarget = ["both", "system", "website"].includes(row[15]) ? row[15] : "both";
      const daysStr = row[16] || "";
      const status = row[17] === "out_of_stock" ? false : true;
      const sortPos = Number(row[18]) || 0;
      const gName = row[19] || "";
      const exName = row[20] || "";
      const exPrice = Number(row[21]) || 0;

      if (!mainCatName || !prodName) continue;

      let menuEntry = menusMap.get(mainCatName);
      if (!menuEntry) {
        menuEntry = { name: mainCatName, itemsMap: new Map() };
        menusMap.set(mainCatName, menuEntry);
      }

      let item = menuEntry.itemsMap.get(prodName);
      if (!item) {
        const daysOfWeek = daysStr
          ? daysStr
              .split(";")
              .map((d) => DAY_NAMES.indexOf(d.trim()))
              .filter((d) => d >= 0)
          : [0, 1, 2, 3, 4, 5, 6];

        item = {
          name: prodName,
          price: posColP,
          category: mainCatName,
          subcategory,
          description,
          dispatchType: { collection: colEn, delivery: delEn, table: tblEn },
          samePrice: sameP,
          channelPrices: {
            posCollection: posColP,
            posDelivery: posDelP,
            posTable: posTblP,
            websiteCollection: webColP,
            websiteDelivery: webDelP,
            websiteTable: webTblP,
          },
          isVegetarian: isVeg,
          displayTarget,
          isAvailable: status,
          sortOrder: sortPos,
          schedule: { enabled: true, startTime: "00:00", endTime: "23:59", daysOfWeek },
          modifierGroupsMap: new Map(),
        };
        menuEntry.itemsMap.set(prodName, item);
      }

      if (gName) {
        let group = item.modifierGroupsMap.get(gName);
        if (!group) {
          group = { name: gName, required: false, maxSelections: 1, options: [] };
          item.modifierGroupsMap.set(gName, group);
        }
        if (exName) {
          group.options.push({ name: exName, price: Math.max(0, exPrice) });
        }
      }
    }

    // 2. Complete Replacement (Module 5 §3) — wipe existing menus for tenant
    await Menu.deleteMany({ ...menuScopeFor(req.user) });

    let createdMenusCount = 0;
    let createdProductsCount = 0;

    for (const [, menuEntry] of menusMap) {
      const items = Array.from(menuEntry.itemsMap.values()).map((item) => ({
        ...item,
        modifierGroups: Array.from(item.modifierGroupsMap.values()),
      }));

      const newMenu = new Menu({
        name: menuEntry.name,
        items,
        createdBy: req.user._id,
        restaurantId: req.user?.restaurantId,
        outletId: req.user?.outletId,
      });

      await newMenu.save();
      createdMenusCount++;
      createdProductsCount += items.length;
    }

    res.status(200).json({
      success: true,
      message: `Menu completely replaced! Added ${createdMenusCount} categories and ${createdProductsCount} products. Remember to update System & Website Cache.`,
      data: { createdMenusCount, createdProductsCount },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportCsv,
  previewCsvImport,
  confirmCsvImport,
};
