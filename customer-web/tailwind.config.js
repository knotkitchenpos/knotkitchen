/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // The store's colors are applied at runtime via CSS variables written by
      // hooks/useThemeVars.js, so Tailwind sees them as `bg-[var(--brand)]`.
      colors: {
        brand: "var(--brand, #e2571e)",
        "brand-fg": "var(--brand-fg, #ffffff)",
        accent: "var(--accent, #f5a524)",
      },
      fontFamily: {
        heading: "var(--font-heading, Poppins), system-ui, sans-serif",
        body: "var(--font-body, Inter), system-ui, sans-serif",
      },
    },
  },
  plugins: [],
};
