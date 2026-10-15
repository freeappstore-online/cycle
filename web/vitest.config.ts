import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.ts so tests don't load the PWA and Tailwind plugins.
// Component tests opt into jsdom with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['./src/test/setup.ts'],
  },
})
