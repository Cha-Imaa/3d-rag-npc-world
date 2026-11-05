import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the local backend, so the browser sees one address.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    // jsdom gives tests a simulated browser page.
    environment: 'jsdom',
  },
})
