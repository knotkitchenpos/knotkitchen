/**
 * menuTextParser.js
 *
 * Deterministic parser for the Knot Kitchen Structured Menu Text format.
 *
 * This is intentionally NOT an AI/OCR/heuristic parser. Employees fill in a
 * predefined Notepad template, so every line either matches a known command
 * exactly or it is reported as an error with its line number. Nothing is
 * guessed, and no missing value is ever invented.
 *
 * Supported commands:
 *   CATEGORY, ITEM, COMBO, DESCRIPTION, PRICE, VARIANT,
 *   ADDON_GROUP, ADDON, CHOICE_GROUP, CHOICE, END ITEM, END CATEGORY
 *
 * Comments start with '#'. Blank lines are ignored.
 */

const COMMANDS = [
  "CATEGORY",
  "ITEM",
  "COMBO",
  "DESCRIPTION",
  "PRICE",
  "VARIANT",
  "ADDON_GROUP",
  "ADDON",
  "CHOICE_GROUP",
  "CHOICE",
];

/** Split "Name | 40" into its pipe-delimited parts. */
const splitPipes = (value) => String(value).split("|").map((p) => p.trim());

/**
 * Strictly parse a price. Returns { ok, value, reason }.
 * Accepts "249", "249.50", "0". Rejects "abc", "", "-5", "12.3.4", "1,299".
 */
const parsePrice = (raw) => {
  const text = String(raw === undefined || raw === null ? "" : raw).trim();

  if (text === "") {
    return { ok: false, reason: "Expected a numeric value but the price was empty." };
  }
  // Deliberately strict: digits with at most one decimal point.
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return {
      ok: false,
      reason: `Expected a numeric value but found "${text}". Write the number only, with no currency symbols, commas or letters (for example: 249).`,
    };
  }

  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, reason: `Expected a numeric value but found "${text}".` };
  }
  return { ok: true, value };
};

/**
 * Parse structured menu text.
 *
 * @param {string} text raw .txt contents
 * @returns {{ success: boolean, errors: Array, categories: Array, stats: object }}
 */
const parseMenuText = (text) => {
  const errors = [];
  const categories = [];

  const addError = (line, content, message) => {
    errors.push({ line, content: String(content ?? "").trim(), message });
  };

  if (typeof text !== "string" || text.trim() === "") {
    return {
      success: false,
      errors: [{ line: 0, content: "", message: "The uploaded file is empty. Download the template and fill in the menu before uploading." }],
      categories: [],
      stats: { categories: 0, items: 0, variants: 0, modifierGroups: 0, options: 0 },
    };
  }

  // Normalise Windows/Mac line endings and strip a UTF-8 BOM from Notepad.
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");

  let currentCategory = null;
  let currentItem = null;
  let currentGroup = null; // { type: 'addon' | 'choice', ref }

  const seenCategoryNames = new Map(); // normalised name -> first line number

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const line = rawLine.trim();

    // Rule 20/21: ignore comments and blank lines entirely.
    if (line === "" || line.startsWith("#")) continue;

    // --- END ITEM / END CATEGORY ---
    const upper = line.toUpperCase();

    if (upper === "END ITEM") {
      if (!currentItem) {
        addError(lineNumber, line, "END ITEM found without a matching ITEM.");
        continue;
      }
      finaliseItem(currentItem, lineNumber, addError);
      currentItem = null;
      currentGroup = null;
      continue;
    }

    if (upper === "END CATEGORY") {
      if (!currentCategory) {
        addError(lineNumber, line, "END CATEGORY found without a matching CATEGORY.");
        continue;
      }
      if (currentItem) {
        addError(
          lineNumber,
          line,
          `END CATEGORY found while item "${currentItem.name}" is still open. Add "END ITEM" before ending the category.`
        );
        finaliseItem(currentItem, lineNumber, addError);
        currentItem = null;
      }
      currentCategory = null;
      currentGroup = null;
      continue;
    }

    // --- COMMAND: VALUE ---
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      addError(
        lineNumber,
        line,
        `Unrecognised line. Every line must be a command such as "ITEM: Name" or "PRICE: 249", a comment starting with #, or blank.`
      );
      continue;
    }

    const command = line.slice(0, separatorIndex).trim().toUpperCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (!COMMANDS.includes(command)) {
      addError(
        lineNumber,
        line,
        `Unknown command "${command}". Supported commands are: ${COMMANDS.join(", ")}, END ITEM, END CATEGORY.`
      );
      continue;
    }

    if (value === "" && command !== "DESCRIPTION") {
      addError(lineNumber, line, `${command} requires a value after the colon.`);
      continue;
    }

    switch (command) {
      // ---------------- CATEGORY ----------------
      case "CATEGORY": {
        if (currentItem) {
          addError(
            lineNumber,
            line,
            `CATEGORY found while item "${currentItem.name}" is still open. Add "END ITEM" before starting a new category.`
          );
          finaliseItem(currentItem, lineNumber, addError);
          currentItem = null;
        }

        const key = value.toLowerCase();
        if (seenCategoryNames.has(key)) {
          addError(
            lineNumber,
            line,
            `Duplicate CATEGORY "${value}". It was already declared on line ${seenCategoryNames.get(key)}. Each category may only be declared once.`
          );
          // Continue into the existing category so later items are not lost.
          currentCategory = categories.find((c) => c.name.toLowerCase() === key);
          currentGroup = null;
          continue;
        }

        seenCategoryNames.set(key, lineNumber);
        currentCategory = { name: value, line: lineNumber, items: [] };
        categories.push(currentCategory);
        currentGroup = null;
        break;
      }

      // ---------------- ITEM / COMBO ----------------
      case "ITEM":
      case "COMBO": {
        if (currentItem) {
          addError(
            lineNumber,
            line,
            `${command} "${value}" started while item "${currentItem.name}" is still open. Add "END ITEM" before starting a new item.`
          );
          finaliseItem(currentItem, lineNumber, addError);
          currentItem = null;
        }

        if (!currentCategory) {
          addError(
            lineNumber,
            line,
            `${command} "${value}" is not inside a CATEGORY. Declare a category first, for example: "CATEGORY: Burgers".`
          );
          // Skip the item entirely - it has nowhere to live.
          currentItem = null;
          currentGroup = null;
          continue;
        }

        const duplicate = currentCategory.items.find(
          (it) => it.name.toLowerCase() === value.toLowerCase()
        );
        if (duplicate) {
          addError(
            lineNumber,
            line,
            `Duplicate item "${value}" in category "${currentCategory.name}". It was already defined on line ${duplicate.line}.`
          );
        }

        currentItem = {
          name: value,
          line: lineNumber,
          description: "",
          price: null,
          isCombo: command === "COMBO",
          variants: [],
          modifierGroups: [],
        };
        currentCategory.items.push(currentItem);
        currentGroup = null;
        break;
      }

      // ---------------- DESCRIPTION ----------------
      case "DESCRIPTION": {
        if (!currentItem) {
          addError(lineNumber, line, "DESCRIPTION must be inside an ITEM.");
          continue;
        }
        if (currentItem.description) {
          addError(
            lineNumber,
            line,
            `"${currentItem.name}" already has a DESCRIPTION. Only one description is allowed per item.`
          );
          continue;
        }
        currentItem.description = value;
        break;
      }

      // ---------------- PRICE ----------------
      case "PRICE": {
        if (!currentItem) {
          addError(lineNumber, line, "PRICE must be inside an ITEM.");
          continue;
        }
        if (currentItem.price !== null) {
          addError(
            lineNumber,
            line,
            `"${currentItem.name}" already has a PRICE. Use VARIANT lines if the item has several prices.`
          );
          continue;
        }

        const price = parsePrice(value);
        if (!price.ok) {
          addError(lineNumber, line, `Invalid price. ${price.reason}`);
          continue;
        }
        currentItem.price = price.value;
        break;
      }

      // ---------------- VARIANT ----------------
      case "VARIANT": {
        if (!currentItem) {
          addError(lineNumber, line, "VARIANT must be inside an ITEM.");
          continue;
        }

        const parts = splitPipes(value);
        if (parts.length !== 2) {
          addError(
            lineNumber,
            line,
            `VARIANT must be written as "VARIANT: Name | Price" (for example: VARIANT: Small | 199).`
          );
          continue;
        }

        const [variantName, variantPriceRaw] = parts;
        if (!variantName) {
          addError(lineNumber, line, "VARIANT is missing a name before the | symbol.");
          continue;
        }

        const variantPrice = parsePrice(variantPriceRaw);
        if (!variantPrice.ok) {
          addError(lineNumber, line, `Invalid variant price. ${variantPrice.reason}`);
          continue;
        }

        if (currentItem.variants.some((v) => v.name.toLowerCase() === variantName.toLowerCase())) {
          addError(
            lineNumber,
            line,
            `Duplicate variant "${variantName}" on item "${currentItem.name}".`
          );
          continue;
        }

        currentItem.variants.push({ name: variantName, price: variantPrice.value, line: lineNumber });
        break;
      }

      // ---------------- ADDON_GROUP ----------------
      case "ADDON_GROUP": {
        if (!currentItem) {
          addError(lineNumber, line, "ADDON_GROUP must be inside an ITEM.");
          continue;
        }

        const group = {
          name: value,
          type: "addon",
          required: false,
          minSelections: 0,
          maxSelections: 0, // 0 = unlimited, resolved at import time
          options: [],
          line: lineNumber,
        };
        currentItem.modifierGroups.push(group);
        currentGroup = group;
        break;
      }

      // ---------------- ADDON ----------------
      case "ADDON": {
        if (!currentItem) {
          addError(lineNumber, line, "ADDON must be inside an ITEM.");
          continue;
        }
        if (!currentGroup || currentGroup.type !== "addon") {
          addError(lineNumber, line, "ADDON must be inside an ADDON_GROUP.");
          continue;
        }

        const parts = splitPipes(value);
        if (parts.length > 2) {
          addError(
            lineNumber,
            line,
            `ADDON must be written as "ADDON: Name | Price" (for example: ADDON: Extra Cheese | 40).`
          );
          continue;
        }

        const addonName = parts[0];
        if (!addonName) {
          addError(lineNumber, line, "ADDON is missing a name.");
          continue;
        }

        // Price is optional; a missing price means free.
        let addonPrice = 0;
        if (parts.length === 2) {
          const parsed = parsePrice(parts[1]);
          if (!parsed.ok) {
            addError(lineNumber, line, `Invalid add-on price. ${parsed.reason}`);
            continue;
          }
          addonPrice = parsed.value;
        }

        if (currentGroup.options.some((o) => o.name.toLowerCase() === addonName.toLowerCase())) {
          addError(
            lineNumber,
            line,
            `Duplicate add-on "${addonName}" in group "${currentGroup.name}".`
          );
          continue;
        }

        currentGroup.options.push({ name: addonName, price: addonPrice, line: lineNumber });
        break;
      }

      // ---------------- CHOICE_GROUP ----------------
      case "CHOICE_GROUP": {
        if (!currentItem) {
          addError(lineNumber, line, "CHOICE_GROUP must be inside an ITEM.");
          continue;
        }

        // CHOICE_GROUP: Name | REQUIRED | 1 | 1   (modifiers optional)
        const parts = splitPipes(value);
        const groupName = parts[0];

        if (!groupName) {
          addError(lineNumber, line, "CHOICE_GROUP is missing a name.");
          continue;
        }

        let required = false;
        let minSelections = 0;
        let maxSelections = 1;
        let valid = true;

        if (parts.length > 1) {
          const flag = parts[1].toUpperCase();
          if (flag !== "REQUIRED" && flag !== "OPTIONAL") {
            addError(
              lineNumber,
              line,
              `CHOICE_GROUP flag must be REQUIRED or OPTIONAL but found "${parts[1]}". Example: "CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1".`
            );
            valid = false;
          } else {
            required = flag === "REQUIRED";
            minSelections = required ? 1 : 0;
          }
        }

        if (valid && parts.length > 2) {
          const min = parsePrice(parts[2]);
          if (!min.ok || !Number.isInteger(min.value)) {
            addError(
              lineNumber,
              line,
              `CHOICE_GROUP minimum must be a whole number but found "${parts[2]}".`
            );
            valid = false;
          } else {
            minSelections = min.value;
          }
        }

        if (valid && parts.length > 3) {
          const max = parsePrice(parts[3]);
          if (!max.ok || !Number.isInteger(max.value)) {
            addError(
              lineNumber,
              line,
              `CHOICE_GROUP maximum must be a whole number but found "${parts[3]}".`
            );
            valid = false;
          } else {
            maxSelections = max.value;
          }
        }

        if (valid && parts.length > 4) {
          addError(
            lineNumber,
            line,
            `CHOICE_GROUP accepts at most "Name | REQUIRED/OPTIONAL | Min | Max" but found ${parts.length} values.`
          );
          valid = false;
        }

        if (valid && maxSelections < minSelections) {
          addError(
            lineNumber,
            line,
            `CHOICE_GROUP maximum (${maxSelections}) cannot be smaller than the minimum (${minSelections}).`
          );
          valid = false;
        }

        if (valid && required && minSelections < 1) {
          addError(
            lineNumber,
            line,
            `CHOICE_GROUP "${groupName}" is REQUIRED so the minimum must be at least 1.`
          );
          valid = false;
        }

        if (!valid) {
          // Still open the group so nested CHOICE lines don't cascade errors.
          currentGroup = { name: groupName, type: "choice", options: [], invalid: true, line: lineNumber };
          continue;
        }

        const group = {
          name: groupName,
          type: "choice",
          required,
          minSelections,
          maxSelections,
          options: [],
          line: lineNumber,
        };
        currentItem.modifierGroups.push(group);
        currentGroup = group;
        break;
      }

      // ---------------- CHOICE ----------------
      case "CHOICE": {
        if (!currentItem) {
          addError(lineNumber, line, "CHOICE must be inside an ITEM.");
          continue;
        }
        if (!currentGroup || currentGroup.type !== "choice") {
          addError(lineNumber, line, "CHOICE must be inside a CHOICE_GROUP.");
          continue;
        }

        const parts = splitPipes(value);
        if (parts.length > 2) {
          addError(
            lineNumber,
            line,
            `CHOICE must be written as "CHOICE: Name" or "CHOICE: Name | Price".`
          );
          continue;
        }

        const choiceName = parts[0];
        if (!choiceName) {
          addError(lineNumber, line, "CHOICE is missing a name.");
          continue;
        }

        let choicePrice = 0;
        if (parts.length === 2) {
          const parsed = parsePrice(parts[1]);
          if (!parsed.ok) {
            addError(lineNumber, line, `Invalid choice price. ${parsed.reason}`);
            continue;
          }
          choicePrice = parsed.value;
        }

        if (currentGroup.options.some((o) => o.name.toLowerCase() === choiceName.toLowerCase())) {
          addError(
            lineNumber,
            line,
            `Duplicate choice "${choiceName}" in group "${currentGroup.name}".`
          );
          continue;
        }

        currentGroup.options.push({ name: choiceName, price: choicePrice, line: lineNumber });
        break;
      }

      default:
        break;
    }
  }

  // --- End of file: nothing may still be open ---
  if (currentItem) {
    addError(
      lines.length,
      `ITEM: ${currentItem.name}`,
      `Item "${currentItem.name}" (started on line ${currentItem.line}) is missing "END ITEM".`
    );
    finaliseItem(currentItem, currentItem.line, addError);
  }

  // --- Structural checks that need the finished tree ---
  categories.forEach((category) => {
    if (category.items.length === 0) {
      addError(
        category.line,
        `CATEGORY: ${category.name}`,
        `Category "${category.name}" has no items. Add at least one ITEM or remove the category.`
      );
    }
  });

  const stats = categories.reduce(
    (acc, category) => {
      acc.categories += 1;
      category.items.forEach((item) => {
        acc.items += 1;
        acc.variants += item.variants.length;
        acc.modifierGroups += item.modifierGroups.length;
        item.modifierGroups.forEach((g) => {
          acc.options += g.options.length;
        });
      });
      return acc;
    },
    { categories: 0, items: 0, variants: 0, modifierGroups: 0, options: 0 }
  );

  errors.sort((a, b) => a.line - b.line);

  return { success: errors.length === 0, errors, categories, stats };
};

/**
 * Validate an item once it is complete (at END ITEM or end of file).
 * Rule 22: an item must have either a PRICE or at least one VARIANT.
 */
function finaliseItem(item, lineNumber, addError) {
  if (item.finalised) return;
  item.finalised = true;

  if (item.price === null && item.variants.length === 0) {
    addError(
      item.line,
      `ITEM: ${item.name}`,
      `"${item.name}" requires either a PRICE or at least one VARIANT.`
    );
  }

  item.modifierGroups.forEach((group) => {
    if (group.options.length === 0) {
      const label = group.type === "addon" ? "ADDON_GROUP" : "CHOICE_GROUP";
      const child = group.type === "addon" ? "ADDON" : "CHOICE";
      addError(
        group.line,
        `${label}: ${group.name}`,
        `${label} "${group.name}" has no options. Add at least one ${child} line or remove the group.`
      );
    }

    // A required choice group cannot demand more selections than it offers.
    if (group.type === "choice" && group.options.length > 0 && group.minSelections > group.options.length) {
      addError(
        group.line,
        `CHOICE_GROUP: ${group.name}`,
        `CHOICE_GROUP "${group.name}" requires at least ${group.minSelections} selections but only has ${group.options.length} choices.`
      );
    }
  });
}

module.exports = { parseMenuText, parsePrice };
