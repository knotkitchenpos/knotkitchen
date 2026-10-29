import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dashboard talks to the KKMDM server same-origin through this proxy,
// so the SameSite=Strict session cookie just works in development.
const target = process.env.KKMDM_API || "http://localhost:8100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5177,
    strictPort: true,
    proxy: {
      "/api": target,
      "/agent": target,
    },
  },
});
