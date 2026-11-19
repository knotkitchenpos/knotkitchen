import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The KnotKitchen Rider app (knotkitchen.com/rider): a store's own delivery
 * riders take its orders out from here. Built from this codebase like the
 * Partners dashboard, into dist/rider, which the POS image serves at /rider/.
 *
 * Its API and socket are same-origin: /rider/api/* -> (Caddy) -> /api/rider/*,
 * /rider/socket.io/* -> /socket.io/*. The rider's session cookie lives on
 * this host under /rider and never travels anywhere else.
 */
const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(here, 'rider'),
  base: '/rider/',
  envDir: here,
  publicDir: path.join(here, 'rider/public'),
  plugins: [react()],
  build: {
    outDir: path.join(here, 'dist/rider'),
    emptyOutDir: true,
  },
  server: {
    port: 5179,
    fs: { allow: [here] },
    proxy: {
      '/rider/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/rider\/api/, '/api/rider'),
      },
      '/rider/socket.io': {
        target: 'http://localhost:8000',
        ws: true,
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/rider\/socket\.io/, '/socket.io'),
      },
    },
  },
})
