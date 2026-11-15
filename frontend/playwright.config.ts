import { defineConfig, devices } from '@playwright/test'

/**
 * Settings for the local browser smoke test (`npm run test:smoke`).
 * It runs on this computer only, not in CI, and makes no paid calls.
 * The test blocks the 3D models, so the browser never draws the village and stays light.
 */
export default defineConfig({
  // Smoke files end in .smoke.ts, so Vitest's unit test run never picks them up.
  testDir: './smoke',
  testMatch: '**/*.smoke.ts',

  // One browser at a time keeps the computer responsive.
  workers: 1,
  fullyParallel: false,

  use: {
    baseURL: 'http://localhost:5173',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Start both servers if they are not running yet. Servers that are already running are
  // reused and left alone. Servers started here are stopped when the test finishes.
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
