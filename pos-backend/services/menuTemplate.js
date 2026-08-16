/**
 * menuTemplate.js
 *
 * The downloadable Notepad template plus the in-app format documentation.
 * Kept beside the parser so the two can never drift apart.
 */

const MENU_TEMPLATE = `# ==========================================================
# KNOT KITCHEN MENU IMPORT TEMPLATE
# ==========================================================
# HOW TO USE
#   1. Replace the example values below with the restaurant's real menu.
#   2. Do NOT delete or rename the command words (CATEGORY, ITEM, PRICE...).
#   3. Save the file as a .txt file, then upload it into Knot Kitchen.
#
# RULES
#   - Lines starting with # are comments and are ignored.
#   - Blank lines are ignored, so use them freely for readability.
#   - Every ITEM needs either a PRICE or at least one VARIANT.
#   - Every ITEM must finish with "END ITEM".
#   - Prices are numbers only: write 249, never Rs.249 or 1,299.
# ==========================================================


CATEGORY: Burgers

# A simple item only needs a name and a price.
ITEM: Chicken Burger
DESCRIPTION: Grilled chicken burger with lettuce, cheese and special sauce
PRICE: 249

# Optional extras. The customer may pick any number of these.
ADDON_GROUP: Extras
ADDON: Extra Cheese | 40
ADDON: Extra Patty | 100
ADDON: Jalapeno | 30
# Use 0 to offer something for free.
ADDON: Ketchup | 0

END ITEM

ITEM: Beef Burger
DESCRIPTION: Beef patty with lettuce and cheese
PRICE: 299
END ITEM


CATEGORY: Pizza

# An item with several sizes uses VARIANT instead of PRICE.
# This stays ONE product with three sizes.
ITEM: Margherita Pizza
DESCRIPTION: Classic pizza with tomato, mozzarella and basil
VARIANT: Small | 199
VARIANT: Medium | 299
VARIANT: Large | 399

# You can have more than one add-on group per item.
ADDON_GROUP: Extra Toppings
ADDON: Extra Cheese | 40
ADDON: Olives | 30

ADDON_GROUP: Extra Meat
ADDON: Chicken | 70
ADDON: Pepperoni | 90

END ITEM


CATEGORY: Combos

# COMBO creates a meal. CHOICE_GROUP lets the customer choose.
# The format is: Name | REQUIRED or OPTIONAL | Minimum | Maximum
COMBO: Chicken Burger Meal
DESCRIPTION: Chicken burger served with a drink and a side
PRICE: 349

CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1
CHOICE: Coke
CHOICE: Pepsi
CHOICE: Sprite

CHOICE_GROUP: Choose Side | REQUIRED | 1 | 1
CHOICE: Fries
CHOICE: Salad

# An optional group: the customer may pick up to 3, or none at all.
CHOICE_GROUP: Extras | OPTIONAL | 0 | 3
CHOICE: Cheese | 40
CHOICE: Jalapeno | 20
CHOICE: Olives | 30

END ITEM


CATEGORY: Sides

ITEM: French Fries
PRICE: 149
END ITEM


CATEGORY: Drinks

ITEM: Coke
VARIANT: 250ml | 40
VARIANT: 500ml | 70
VARIANT: 1L | 120
END ITEM
`;

/**
 * Structured documentation rendered by the "View Format Instructions" panel.
 */
const FORMAT_DOCS = [
  {
    id: "basics",
    title: "The Basics",
    body: "Each line is a command followed by a colon and a value. Lines starting with # are comments and are ignored, and blank lines are ignored too. Commands are not case sensitive, but keeping them uppercase makes the file easier to read.",
    example: "# This is a comment\nCATEGORY: Burgers",
  },
  {
    id: "category",
    title: "Category",
    body: "Starts a new section of the menu. Every item that follows belongs to this category until the next CATEGORY line. Each category can only be declared once.",
    example: "CATEGORY: Burgers",
  },
  {
    id: "basic-item",
    title: "Basic Item",
    body: "A simple product. DESCRIPTION is optional, but every item needs either a PRICE or at least one VARIANT, and must end with END ITEM.",
    example: "ITEM: Chicken Burger\nDESCRIPTION: Grilled chicken burger\nPRICE: 249\nEND ITEM",
  },
  {
    id: "variant-item",
    title: "Variant Item",
    body: "Use VARIANT when one product is sold in several sizes. This creates ONE product with multiple sizes, not several separate products. Do not add a PRICE line when using variants.",
    example: "ITEM: Margherita Pizza\nVARIANT: Small | 199\nVARIANT: Medium | 299\nVARIANT: Large | 399\nEND ITEM",
  },
  {
    id: "addons",
    title: "Add-ons",
    body: "Optional extras the customer can add. Every ADDON must sit inside an ADDON_GROUP. Use a price of 0 to offer a free add-on. An item can have as many add-on groups as you need.",
    example: "ADDON_GROUP: Extras\nADDON: Extra Cheese | 40\nADDON: Ketchup | 0",
  },
  {
    id: "choices",
    title: "Choices",
    body: "Use CHOICE_GROUP when the customer must pick from a list. The format is Name | REQUIRED or OPTIONAL | Minimum | Maximum. Choices can be free or priced. Every CHOICE must sit inside a CHOICE_GROUP.",
    example: "CHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1\nCHOICE: Coke\nCHOICE: Pepsi",
  },
  {
    id: "optional-choices",
    title: "Optional Choices",
    body: "An OPTIONAL group lets the customer skip it. Here they may pick between 0 and 3 extras, and each one adds to the price.",
    example: "CHOICE_GROUP: Extras | OPTIONAL | 0 | 3\nCHOICE: Cheese | 40\nCHOICE: Jalapeno | 20",
  },
  {
    id: "combos",
    title: "Combos and Meals",
    body: "COMBO works exactly like ITEM but marks the product as a meal. Combine it with CHOICE_GROUP lines to let the customer build their meal. Close it with END ITEM.",
    example: "COMBO: Burger Meal\nPRICE: 349\nCHOICE_GROUP: Choose Drink | REQUIRED | 1 | 1\nCHOICE: Coke\nCHOICE: Pepsi\nEND ITEM",
  },
  {
    id: "prices",
    title: "Writing Prices",
    body: "Prices must be plain numbers. Write 249 or 249.50. Do not write currency symbols, commas or words, otherwise the upload will be rejected with an error.",
    example: "PRICE: 249      # correct\nPRICE: Rs.249   # rejected\nPRICE: 1,299    # rejected",
  },
];

/** Commands accepted by the parser, for display in the UI. */
const COMMAND_REFERENCE = [
  { command: "CATEGORY", usage: "CATEGORY: Burgers", description: "Starts a new menu category." },
  { command: "ITEM", usage: "ITEM: Chicken Burger", description: "Starts a new product." },
  { command: "COMBO", usage: "COMBO: Burger Meal", description: "Starts a new combo/meal product." },
  { command: "DESCRIPTION", usage: "DESCRIPTION: Text", description: "Optional description for the current item." },
  { command: "PRICE", usage: "PRICE: 249", description: "Price of the current item." },
  { command: "VARIANT", usage: "VARIANT: Small | 199", description: "A size/option of the current item." },
  { command: "ADDON_GROUP", usage: "ADDON_GROUP: Extras", description: "Starts a group of optional extras." },
  { command: "ADDON", usage: "ADDON: Extra Cheese | 40", description: "An extra inside the current add-on group." },
  { command: "CHOICE_GROUP", usage: "CHOICE_GROUP: Drink | REQUIRED | 1 | 1", description: "Starts a group the customer chooses from." },
  { command: "CHOICE", usage: "CHOICE: Coke", description: "An option inside the current choice group." },
  { command: "END ITEM", usage: "END ITEM", description: "Closes the current item. Required." },
  { command: "END CATEGORY", usage: "END CATEGORY", description: "Closes the current category. Optional." },
];

module.exports = { MENU_TEMPLATE, FORMAT_DOCS, COMMAND_REFERENCE };
