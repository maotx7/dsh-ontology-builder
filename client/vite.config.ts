import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served by the plugin under /ontology/ (see src/web/server.ts).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/ontology/',
  plugins: [react()],
  // Dev only: forward the plugin API to the running DSH web server so the
  // standalone Vite server renders real data (UI uses same-origin api/ calls).
  server: {
    proxy: {
      '/ontology/api': {
        target: 'http://127.0.0.1:3080',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: fileURLToPath(new URL('../dist/ui', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  }
})
