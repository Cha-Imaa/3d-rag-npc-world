import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the local backend, so the browser sees one address.
    proxy: {
      '/api': 'http://localhost:8000',
    },
    // Tests read the NPC files to check placement. The app itself gets NPCs from the API,
    // so the dev server keeps its default of serving nothing outside the frontend folder.
    fs: process.env.VITEST ? { allow: ['.', '../data/npcs'] } : undefined,
  },
  test: {
    // jsdom gives tests a simulated browser page.
    environment: 'jsdom',
  },
})
