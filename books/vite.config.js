import { defineConfig } from "vite";

// Local: the API runs on :8000 and /api is proxied, so the app is same-origin.
// The proxy drops the Origin header, as the backend only trusts listed origins.
export default defineConfig({
  server: {
    port: 5181,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        configure: (proxy) => proxy.on("proxyReq", (req) => req.removeHeader("origin")),
      },
    },
  },
  build: { outDir: "dist", target: "es2020" },
});
