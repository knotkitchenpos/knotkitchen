/**
 * menuImportController.js
 *
 * Structured Notepad menu import.
 *
 * Flow: download template -> upload .txt -> parse -> validate -> preview -> import.
 * Nothing is written to the database until the employee confirms the preview,
 * and a file containing any error is never partially imported.
 */

const createHttpError = require("http-errors");
const Menu = require("../models/menuModel");
const AuditLog = require("../models/auditLogModel");
const { parseMenuText } = require("../services/menuTextParser");
const { buildMenuPayload, buildPreviewTree } = require("../services/menuImportMapper");
const { MENU_TEMPLATE, FORMAT_DOCS, COMMAND_REFERENCE } = require("../services/menuTemplate");

/** Cap the upload so a pasted novel can't exhaust memory. */
const MAX_TEXT_LENGTH = 1024 * 1024; // 1 MB of plain text

/** Pull the menu text out of either a JSON body or an uploaded file. */
const extractText = (req) => {
  if (req.file && req.file.buffer) return req.file.buffer.toString("utf8");
  if (typeof req.body?.text === "string") return req.body.text;
  if (typeof req.body?.content === "string") return req.body.content;
  return null;
};

/**
 * GET /api/menu/import/template
 * Downloads the .txt template the employee fills in.
 */
const downloadTemplate = async (req, res, next) => {
  try {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="knotkitchen-menu-template.txt"');
    res.status(200).send(MENU_TEMPLATE);
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/menu/import/format
 * Returns the documentation shown in "View Format Instructions".
 */
const getFormatDocs = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: { sections: FORMAT_DOCS, commands: COMMAND_REFERENCE, template: MENU_TEMPLATE },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/menu/import/preview
 * Parses and validates the text. Returns either errors or a preview.
 * Never writes to the database.
 */
const previewImport = async (req, res, next) => {
  try {
    const text = extractText(req);

    if (text === null) {
      return next(createHttpError(400, "No menu file was uploaded. Choose a .txt file and try again."));
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return next(createHttpError(413, "That menu file is too large. The limit is 1 MB of text."));
    }

    const parsed = parseMenuText(text);

    // Rule 24: if there are errors, show them and do NOT import.
    if (!parsed.success) {
      return res.status(200).json({
        success: false,
        message: `Found ${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"} in the menu file. Fix them in Notepad and upload again.`,
        data: { valid: false, errors: parsed.errors, errorCount: parsed.errors.length },
      });
    }

    const categories = buildMenuPayload(parsed.categories);
    const tree = buildPreviewTree(parsed.categories);

    res.status(200).json({
      success: true,
      message: "Menu file is valid. Review the preview and click Import Menu to continue.",
      data: { valid: true, errors: [], stats: parsed.stats, tree, categories },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/menu/import
 * Re-parses and re-validates the text, then writes it using the existing
 * Menu model. Re-parsing (rather than trusting a client-supplied tree) keeps
 * the import path impossible to bypass.
 */
const importMenu = async (req, res, next) => {
  try {
    const text = extractText(req);

    if (text === null) {
      return next(createHttpError(400, "No menu file was provided for import."));
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return next(createHttpError(413, "That menu file is too large. The limit is 1 MB of text."));
    }

    // Re-validate: never trust a preview round-trip.
    const parsed = parseMenuText(text);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: "This menu file still contains errors and was not imported.",
        data: { valid: false, errors: parsed.errors, errorCount: parsed.errors.length },
      });
    }

    const payload = buildMenuPayload(parsed.categories);

    // "replace" wipes matching categories first; "merge" (default) appends
    // items into an existing category of the same name.
    const mode = req.body?.mode === "replace" ? "replace" : "merge";

    const created = [];
    const updated = [];

    for (const category of payload) {
      const existing = await Menu.findOne({
        name: category.name,
        createdBy: req.user._id,
        isDeleted: { $ne: true },
      });

      if (!existing) {
        const menu = await Menu.create({
          name: category.name,
          items: category.items,
          createdBy: req.user._id,
          restaurantId: req.user.restaurantId,
          outletId: req.user.outletId,
        });
        created.push({ id: menu._id, name: menu.name, items: menu.items.length });
        continue;
      }

      if (mode === "replace") {
        existing.items = category.items;
      } else {
        // Merge: replace same-named dishes in place, append the rest.
        category.items.forEach((incoming) => {
          const index = existing.items.findIndex(
            (it) => it.name.toLowerCase() === incoming.name.toLowerCase()
          );
          if (index === -1) {
            existing.items.push(incoming);
          } else {
            existing.items[index] = { ...incoming, _id: existing.items[index]._id };
          }
        });
      }

      await existing.save();
      updated.push({ id: existing._id, name: existing.name, items: existing.items.length });
    }

    await AuditLog.create({
      userId: req.user._id,
      restaurantId: req.user.restaurantId,
      action: "MENU.IMPORT",
      resource: "Menu",
      description: `Structured text menu import: ${parsed.stats.categories} categories, ${parsed.stats.items} items (${created.length} created, ${updated.length} updated, mode=${mode})`,
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    }).catch(() => {}); // auditing must never block a successful import

    res.status(201).json({
      success: true,
      message: `Menu imported successfully! ${parsed.stats.items} item${parsed.stats.items === 1 ? "" : "s"} across ${parsed.stats.categories} categor${parsed.stats.categories === 1 ? "y" : "ies"}.`,
      data: { created, updated, stats: parsed.stats, mode },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { downloadTemplate, getFormatDocs, previewImport, importMenu };
