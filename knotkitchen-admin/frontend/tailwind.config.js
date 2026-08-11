/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0fdf6",
          100: "#dcfce9",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
        },
      },
      fontFamily: {
        display: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
};