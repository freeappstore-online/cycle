import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// jsPDF's optional HTML/SVG renderers; the text-only PDF never loads them.
const jspdfUnused = '/src/report/jspdf-unused.ts'

export default defineConfig({
  resolve: {
    alias: { html2canvas: jspdfUnused, canvg: jspdfUnused, dompurify: jspdfUnused },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Our own service worker (src/sw.ts) so it can handle fas.push
      // reminders (#148). It keeps what the generated one did: precache
      // everything below, skipWaiting + clientsClaim so deploys apply at
      // once, and the index.html navigation fallback (/api and /v1 denied)
      // so the app opens offline from the home screen.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm,json}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
      // Manifest is defined in web/public/manifest.json (single source of truth).
      // VitePWA reads it from there automatically when manifest is false.
      manifest: false,
    }),
  ],
  server: { host: true },
})
