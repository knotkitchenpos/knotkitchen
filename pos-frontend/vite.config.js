import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Offline-first till: the service worker (public/sw.js) stores EVERY file of
 * the build when it installs, not just the pages someone happened to open
 * online. This writes the build's file list and a build id into dist/sw.js,
 * so each deploy is a new service worker that stores the new files before it
 * takes over (and drops the old ones).
 */
const precacheServiceWorker = () => {
  let outDir = 'dist'
  const files = new Set()
  return {
    name: 'kk-precache-sw',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        // Source maps are for debugging, not for the till.
        if (!name.endsWith('.map')) files.add(`/${name}`)
      }
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const buildId = Date.now().toString(36)
      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace('"__KK_BUILD_ID__"', JSON.stringify(buildId))
        .replace('["__KK_PRECACHE__"]', JSON.stringify([...files].sort()))
      fs.writeFileSync(swPath, sw)
    },
  }
}

// https/vite.dev/config/
export default defineConfig({
  plugins: [react(), precacheServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
