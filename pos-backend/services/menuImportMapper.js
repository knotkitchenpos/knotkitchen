/**
 * menuImportMapper.js
 *
 * Maps the output of menuTextParser onto the EXISTING Knot Kitchen menu models.
 * No new menu system is introduced here - this only produces plain objects that
 * fit the current schemas:
 *
 *   CATEGORY      -> a Menu document (Menu.name is the category name)
 *   ITEM / COMBO  -> menu.items[] entry (menuItemSchema)
 *   VARIANT       -> item.variants[] (variantSchema)
 *   ADDON_GROUP   -> item.modifierGroups[] with groupType "addon"
 *   ADDON         -> modifierGroup.options[] (modifierOptionSchema)
 *   CHOICE_GROUP  -> item.modifierGroups[] with groupType "choice"
 *   CHOICE        -> modifierGroup.options[] (modifierOptionSchema)
 *   COMBO         -> item.isCombo = true (+ comboItems from required choices)
 *
 * Mongo generates all _id values, so employees never type database IDs.
 */

/**
 * The item's base price.
 * Items priced only through variants use the cheapest variant as the base
 * price, because menuItemSchema requires a numeric price.
 */
const resolveItemPrice = (item) => {
  if (item.price !== null && item.price !== undefined) return item.price;
  if (item.variants.length > 0) {
    return item.variants.reduce((min, v) => (v.price < min ? v.price : min), item.variants[0].price);
  }
  return 0; // unreachable for valid files - validation guarantees price or variants
};

/** Convert one parsed modifier group into the existing modifierGroupSchema shape. */
const mapModifierGroup = (group) => {
  const options = group.options.map((o) => ({ name: o.name, price: o.price, isAvailable: true }));

  if (group.type === "addon") {
    return {
      name: group.name,
      groupType: "addon",
      required: false,
      minSelections: 0,
      // Add-on groups are unbounded: the customer may take every extra.
      maxSelections: options.length,
      options,
    };
  }

  return {
    name: group.name,
    groupType: "choice",
    required: Boolean(group.required),
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    options,
  };
};

/** Convert one parsed item into the existing menuItemSchema shape. */
const mapItem = (item, categoryName) => {
  const modifierGroups = item.modifierGroups.map(mapModifierGroup);

  // Combos list the options of their required choice groups so the existing
  // combo UI has something meaningful to show.
  const comboItems = item.isCombo
    ? item.modifierGroups
        .filter((g) => g.type === "choice" && g.required)
        .flatMap((g) => g.options.map((o) => o.name))
    : [];

  return {
    name: item.name,
    price: resolveItemPrice(item),
    category: categoryName,
    description: item.description || "",
    isAvailable: true,
    variants: item.variants.map((v) => ({ name: v.name, price: v.price, isAvailable: true })),
    // ADDON_GROUP maps to modifierGroups (the richer, grouped structure) rather
    // than the flat addons[] array, so grouping is preserved.
    addons: [],
    modifierGroups,
    isCombo: Boolean(item.isCombo),
    comboDescription: item.isCombo ? item.description || "" : "",
    comboItems,
  };
};

/**
 * Build the payload used for both preview and import.
 * @returns {Array<{ name, items: Array }>}
 */
const buildMenuPayload = (categories) =>
  categories.map((category) => ({
    name: category.name,
    items: category.items.map((item) => mapItem(item, category.name)),
  }));

/**
 * Render the ASCII tree shown in the Menu Preview step.
 * Purely cosmetic - the employee uses it to eyeball the whole menu.
 */
const buildPreviewTree = (categories, currency = "\u20B9") => {
  const lines = [];

  categories.forEach((category, categoryIndex) => {
    if (categoryIndex > 0) lines.push("");
    lines.push(category.name);

    category.items.forEach((item, itemIndex) => {
      const lastItem = itemIndex === category.items.length - 1;
      const itemBranch = lastItem ? "└── " : "├── ";
      const itemPad = lastItem ? "    " : "│   ";

      lines.push(`${itemBranch}${item.name}${item.isCombo ? "  [COMBO]" : ""}`);

      if (item.price !== null && item.price !== undefined) {
        lines.push(`${itemPad}${currency}${item.price}`);
      }

      if (item.description) {
        lines.push(`${itemPad}${item.description}`);
      }

      // Variants
      item.variants.forEach((variant, variantIndex) => {
        const lastVariant = variantIndex === item.variants.length - 1;
        const variantBranch = lastVariant && item.modifierGroups.length === 0 ? "└── " : "├── ";
        lines.push(`${itemPad}${variantBranch}${variant.name} ${currency}${variant.price}`);
      });

      // Modifier groups (add-ons and choices)
      item.modifierGroups.forEach((group, groupIndex) => {
        const lastGroup = groupIndex === item.modifierGroups.length - 1;
        lines.push(`${itemPad}`);

        let label = group.name;
        if (group.type === "choice") {
          const rule = group.required ? "Required" : "Optional";
          label += `  (${rule}, choose ${group.minSelections}-${group.maxSelections})`;
        }
        lines.push(`${itemPad}${label}`);

        group.options.forEach((option, optionIndex) => {
          const lastOption = optionIndex === group.options.length - 1;
          const optionBranch = lastOption ? "└── " : "├── ";
          const priceLabel = option.price > 0 ? ` +${currency}${option.price}` : " (free)";
          lines.push(`${itemPad}${optionBranch}${option.name}${priceLabel}`);
        });

        if (!lastGroup) lines.push(`${itemPad}`);
      });
    });
  });

  return lines.join("\n");
};

module.exports = { buildMenuPayload, buildPreviewTree, resolveItemPrice, mapItem, mapModifierGroup };
