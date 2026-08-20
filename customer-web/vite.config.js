import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Customer website — Vite config.
 *
 * The dev server accepts *.localhost so a developer can hit
 * http://burger-house.localhost:5175 and see the same hostname resolution the
 * production wildcard subdomain uses. `host: true` binds to all interfaces so
 * you can also test from a phone on the same LAN.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5175,
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
