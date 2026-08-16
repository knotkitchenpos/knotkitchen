/**
 * Theme registry (§4).
 *
 * A theme is pure *presentation metadata*: it declares which layout options it
 * supports and what its default colors/typography are. The storefront ordering
 * engine (menu → cart → checkout → order) is theme-agnostic, so adding
 * "Modern Takeaway" or "Cafe" later is a matter of appending an entry here plus
 * a matching renderer component on the frontend — no backend rewrite.
 */

const DEFAULT_THEME_KEY = "default-restaurant";

const THEMES = [
  {
    key: "default-restaurant",
    name: "Classic Restaurant",
    description:
      "A warm, food-photography-led template that suits most restaurants and takeaways.",
    status: "available",
    preview: "/themes/default-restaurant.png",
    supports: {
      heroStyle: ["classic", "split", "minimal", "fullbleed"],
      productCardStyle: ["grid", "list", "compact", "showcase"],
      categoryNavStyle: ["pills", "tabs", "sidebar"],
      headerStyle: ["standard", "centered", "transparent"],
      footerStyle: ["standard", "minimal", "detailed"],
    },
    defaults: {
      colors: {
        primary: "#e2571e",
        secondary: "#0d1526",
        accent: "#f5a524",
        background: "#ffffff",
        surface: "#f7f8fa",
        text: "#12161f",
        muted: "#6b7280",
        button: "#e2571e",
        buttonText: "#ffffff",
      },
      typography: { headingFont: "Poppins", bodyFont: "Inter", baseSize: 16 },
      layout: {
        heroStyle: "classic",
        productCardStyle: "grid",
        categoryNavStyle: "pills",
        productImagePosition: "top",
        buttonStyle: "rounded",
        headerStyle: "standard",
        footerStyle: "standard",
      },
    },
  },
  // Planned themes are declared up-front so the Settings UI can display them as
  // "coming soon" without shipping half-built renderers.
  { key: "modern-takeaway", name: "Modern Takeaway", status: "coming-soon" },
  { key: "premium-restaurant", name: "Premium Restaurant", status: "coming-soon" },
  { key: "cafe", name: "Cafe", status: "coming-soon" },
  { key: "cloud-kitchen", name: "Cloud Kitchen", status: "coming-soon" },
  { key: "fast-food", name: "Fast Food", status: "coming-soon" },
  { key: "bakery", name: "Bakery", status: "coming-soon" },
];

const listThemes = () => THEMES;

const getTheme = (key) => THEMES.find((t) => t.key === key) || null;

/** Only themes marked "available" may actually be selected by a store. */
const isSelectableTheme = (key) => {
  const theme = getTheme(key);
  return Boolean(theme && theme.status === "available");
};

const getDefaultTheme = () => getTheme(DEFAULT_THEME_KEY);

module.exports = {
  THEMES,
  DEFAULT_THEME_KEY,
  listThemes,
  getTheme,
  isSelectableTheme,
  getDefaultTheme,
};
