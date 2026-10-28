import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served by the plugin under /ontology/ (see src/web/server.ts).
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/ontology/',
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('../dist/ui', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500
  }
})
