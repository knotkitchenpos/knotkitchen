import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Customer website — Vite config.
 *
 * The dev server accepts *.localhost so a developer can hit
 * http://burger-house.localhost:5176 and see the same hostname resolution the
 * production wildcard subdomain uses. `host: true` binds to all interfaces so
 * you can also test from a phone on the same LAN.
 *
 * PORT: 5176, not 5175. csd-web already claims 5175 (its vite.config.js and
 * .claude/launch.json both pin it), and `strictPort` below means this server
 * refuses to start rather than silently drifting to another port — so the two
 * apps could not previously be run at the same time. Keep these distinct:
 *   5173 pos-frontend · 5174 admin frontend · 5175 csd-web · 5176 customer-web
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5176,
    // Deliberate: a wildcard-subdomain app that silently moved to another port
    // would break the *.localhost URLs a developer has open.
    strictPort: true,
    // Vite blocks unknown hosts by default in dev — allow any *.localhost so
    // subdomain-based tenant resolution works locally.
    allowedHosts: [".localhost", "localhost", "127.0.0.1"],
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    // Standalone site (served by nginx). No source maps in production to keep
    // internal file paths out of the client.
    sourcemap: false,
    outDir: "dist",
  },
});
