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
        surface: {
          DEFAULT: "var(--bg-surface)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
          input: "var(--bg-input)",
        },
        content: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        border: {
          DEFAULT: "var(--border-color)",
        },
        accent: {
          DEFAULT: "#059669",
          blue: "#3b82f6",
          green: "#10b981",
          red: "#ef4444",
          amber: "#f59e0b",
        },
      },
      boxShadow: {
        card: "var(--shadow-card)",
        hover: "var(--shadow-hover)",
      },
    },
  },
  plugins: [
    require('tailwind-scrollbar-hide')
  ],
}