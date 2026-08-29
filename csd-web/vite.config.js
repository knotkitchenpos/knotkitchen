import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      // Dev only. In production the SPA is served by Caddy and talks to
      // https://api.<BASE_DOMAIN>/api/csd via VITE_API_BASE_URL.
      "/api": { target: "http://localhost:8000", changeOrigin: true },
    },
  },
});
