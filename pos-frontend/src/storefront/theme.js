/**
 * Storefront theme engine.
 *
 * Converts the store's saved (already server-validated) theme settings into CSS
 * custom properties. Because the backend only ever persists hex colors and
 * enum layout values, nothing here can inject arbitrary CSS.
 *
 * Adding a new theme later = adding a renderer that reads the same variables;
 * the ordering engine is untouched.
 */

const FALLBACK = {
  primary: "#e2571e",
  secondary: "#0d1526",
  accent: "#f5a524",
  background: "#ffffff",
  surface: "#f7f8fa",
  text: "#12161f",
  muted: "#6b7280",
  button: "#e2571e",
  buttonText: "#ffffff",
};

// Defence-in-depth: re-validate hex on the client too, in case of a stale or
// hand-edited API response.
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const safeColor = (value, fallback) => (HEX.test(String(value || "")) ? value : fallback);

const SAFE_FONTS = new Set([
  "Inter", "Poppins", "Roboto", "Open Sans", "Lato",
  "Montserrat", "Nunito", "Playfair Display", "Merriweather", "system-ui",
]);

const fontStack = (font) => {
  const safe = SAFE_FONTS.has(font) ? font : "Inter";
  return `'${safe}', system-ui, -apple-system, 'Segoe UI', sans-serif`;
};

export const buildThemeVars = (theme) => {
  const colors = theme?.colors || {};
  const typography = theme?.typography || {};
  const radiusByStyle = { rounded: "0.75rem", pill: "9999px", square: "0.125rem" };

  return {
    "--sf-primary": safeColor(colors.primary, FALLBACK.primary),
    "--sf-secondary": safeColor(colors.secondary, FALLBACK.secondary),
    "--sf-accent": safeColor(colors.accent, FALLBACK.accent),
    "--sf-bg": safeColor(colors.background, FALLBACK.background),
    "--sf-surface": safeColor(colors.surface, FALLBACK.surface),
    "--sf-text": safeColor(colors.text, FALLBACK.text),
    "--sf-muted": safeColor(colors.muted, FALLBACK.muted),
    "--sf-button": safeColor(colors.button, FALLBACK.button),
    "--sf-button-text": safeColor(colors.buttonText, FALLBACK.buttonText),
    "--sf-heading-font": fontStack(typography.headingFont),
    "--sf-body-font": fontStack(typography.bodyFont),
    "--sf-base-size": `${Math.min(20, Math.max(12, Number(typography.baseSize) || 16))}px`,
    "--sf-radius": radiusByStyle[theme?.layout?.buttonStyle] || radiusByStyle.rounded,
  };
};

/** Load only the fonts a store actually uses (performance, §23). */
export const buildFontUrl = (theme) => {
  const fonts = new Set();
  const heading = theme?.typography?.headingFont;
  const body = theme?.typography?.bodyFont;
  [heading, body].forEach((f) => {
    if (f && SAFE_FONTS.has(f) && f !== "system-ui") fonts.add(f);
  });
  if (!fonts.size) return null;

  const families = [...fonts].map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
};

export const formatPrice = (amount, symbol = "₹") => {
  const value = Number(amount) || 0;
  // Whole numbers read better without trailing ".00" on a menu.
  return `${symbol}${value % 1 === 0 ? value.toFixed(0) : value.toFixed(2)}`;
};
