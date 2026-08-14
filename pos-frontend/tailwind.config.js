/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#080F1F",
          900: "#080F1F",
          800: "#0D1526",
          700: "#111B2E",
          600: "#162238",
        },
        surface: {
          DEFAULT: "#080F1F",
          secondary: "#0D1526",
          tertiary: "#111B2E",
          card: "#111B2E",
          elevated: "#162238",
          input: "#0D1526",
        },
        content: {
          DEFAULT: "#F5F7FA",
          secondary: "#AEB8CA",
          muted: "#77839A",
          disabled: "#556176",
        },
        border: {
          DEFAULT: "#26344B",
          subtle: "#1D2A3D",
          focused: "#FF5A00",
        },
        accent: {
          DEFAULT: "#FF5A00",
          orange: "#FF5A00",
          bright: "#FF6A00",
          hover: "#FF7A1A",
          dark: "#E94D00",
          blue: "#3B82F6",
          green: "#22C55E",
          red: "#EF4444",
          amber: "#F59E0B",
        },
      },
      boxShadow: {
        card: "0 12px 40px rgba(0, 0, 0, 0.25)",
        hover: "0 16px 48px rgba(0, 0, 0, 0.35)",
        orange: "0 8px 25px rgba(255, 90, 0, 0.25)",
        glow: "0 0 20px rgba(255, 90, 0, 0.15)",
      },
    },
  },
  plugins: [
    require('tailwind-scrollbar-hide')
  ],
}
