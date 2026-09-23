/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Landscape tablets (about 1280x730 inside the app): the cart panel's
      // fixed header and footer are compacted so the item list keeps room.
      screens: { short: { raw: "(max-height: 820px)" } },
      colors: {
        // Exact reference design tokens
        sidebar: "#0B1120",
        "sidebar-hover": "#1A2237",
        purple: {
          DEFAULT: "#5B42F3",
          hover: "#4A32E0",
          light: "#EEF0FE",
        },
        // The Manage Table modals were written against a token set that was
        // never added to this config — bg-surface-secondary, text-content,
        // border-border, bg-accent/5 and friends. Tailwind silently generates
        // nothing for an unknown token, so those panels had NO background at
        // all and rendered as a near-invisible sheet over the blurred
        // backdrop. Defining them here fixes every such modal at once and
        // cannot affect anything else, because nothing could have been using
        // classes that did not exist.
        surface: {
          DEFAULT: "#FFFFFF",
          secondary: "#FFFFFF",
          input: "#F8FAFC",
          tertiary: "#F1F5F9",
        },
        content: {
          DEFAULT: "#0F172A",
          muted: "#64748B",
        },
        border: {
          DEFAULT: "#E2E8F0",
        },
        accent: {
          DEFAULT: "#5B42F3",
          red: "#DC2626",
          green: "#16A34A",
          blue: "#2563EB",
          amber: "#F59E0B",
        },
        canvas: "#F8FAFC",
        ink: "#0F172A",
        "ink-2": "#475569",
        "ink-3": "#94A3B8",
        line: "#E2E8F0",
        "line-2": "#F1F5F9",
        // Category tile colors from reference
        cat: {
          orange: "#F97316",
          "orange-2": "#FB6514",
          red: "#EF4444",
          blue: "#2563EB",
          amber: "#F59E0B",
          green: "#16A34A",
          violet: "#6D28D9",
          indigo: "#4F46E5",
        },
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "sans-serif"],
      },
      boxShadow: {
        soft: "0 1px 2px 0 rgba(15,23,42,0.04)",
        card: "0 1px 3px 0 rgba(15,23,42,0.06), 0 1px 2px -1px rgba(15,23,42,0.06)",
        pop: "0 10px 30px -6px rgba(15,23,42,0.12)",
        purple: "0 8px 20px -6px rgba(91,66,243,0.45)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
