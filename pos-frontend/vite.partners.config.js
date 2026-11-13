import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The Partners dashboard (knotkitchen.com/partners): the owner's view of all
 * their stores, with Billing and Reports moved here from the POS. Built from
 * this same codebase so those screens are the POS's own (src/partners/mode.js),
 * into dist/partners, which the POS image serves at /partners/.
 *
 * Its API is same-origin: /partners/api/* -> (Caddy) -> /api/partners/*.
 */
const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: path.join(here, 'partners'),
  base: '/partners/',
  envDir: here,
  publicDir: path.join(here, 'partners/public'),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_KK_APP': JSON.stringify('partners'),
  },
  build: {
    outDir: path.join(here, 'dist/partners'),
    emptyOutDir: true,
  },
  server: {
    port: 5176,
    fs: { allow: [here] },
    proxy: {
      '/partners/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/partners\/api/, '/api/partners'),
      },
    },
  },
})
