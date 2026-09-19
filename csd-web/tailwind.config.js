/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // KnotKitchen brand: navy structure, orange action. The neutrals are
        // tinted towards the logo navy (#0a1b45) so greys, borders and the
        // sidebar all belong to the same family as knotkitchen.com.
        navy: {
          50: "#f4f6fb", 100: "#e9edf6", 200: "#d3dae9", 300: "#a6b2cf",
          400: "#7686ad", 500: "#53638c", 600: "#3d4b72", 700: "#2b3759",
          800: "#172448", 900: "#0e1a3a", 950: "#070f26",
        },
        brand: {
          50: "#fff5ec", 100: "#ffe8d4", 200: "#fecda6", 300: "#fdab6f",
          400: "#fb8337", 500: "#f4620a", 600: "#e0530a", 700: "#b9420a",
          800: "#933610", 900: "#772f11",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(10,27,69,.04), 0 8px 24px rgba(10,27,69,.06)",
        pop: "0 2px 4px rgba(10,27,69,.06), 0 18px 48px rgba(10,27,69,.14)",
        glow: "0 8px 24px rgba(244,98,10,.35)",
      },
      keyframes: {
        "fade-up": { from: { opacity: 0, transform: "translateY(10px)" }, to: { opacity: 1, transform: "none" } },
        grow: { from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } },
        // translate only: scaling a large soft glow re-rasterises it every frame
        drift: { "0%,100%": { transform: "translate3d(0,0,0)" }, "50%": { transform: "translate3d(-34px,30px,0)" } },
      },
      animation: {
        "fade-up": "fade-up .45s cubic-bezier(.2,.7,.2,1) both",
        grow: "grow .8s cubic-bezier(.2,.7,.2,1) both",
        drift: "drift 18s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
