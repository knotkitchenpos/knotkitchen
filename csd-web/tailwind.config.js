/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // KnotKitchen brand: navy structure, orange action.
        navy: {
          50: "#f3f5f9", 100: "#e5e9f2", 200: "#c7d0e2", 300: "#9aa9c6",
          400: "#6c7da4", 500: "#4c5c85", 600: "#3a476a", 700: "#2c3652",
          800: "#1d2540", 900: "#131a30", 950: "#0b1020",
        },
        brand: {
          50: "#fff4ed", 100: "#ffe6d5", 200: "#feccaa", 300: "#fdaa74",
          400: "#fb7d3c", 500: "#f95d16", 600: "#ea420c", 700: "#c2300c",
          800: "#9a2812", 900: "#7c2412",
        },
      },
      fontFamily: { display: ["Inter", "system-ui", "sans-serif"] },
    },
  },
  plugins: [],
};
