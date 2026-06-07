import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the UC5 LOCAL stand-up browser suite (OI-28,
 * principles/02). Unlike the smoke config (which runs against a deployed
 * PROD_URL), this suite runs in the BUILD phase against the LOCAL stand-up:
 * Playwright starts the stand-up itself via `webServer` (the run-local entry),
 * then drives two browser contexts through the move-relay flow.
 *
 * The stand-up is the local WS server + the SPA dev server with a local
 * /config.js (wsUrl=ws://localhost:8787, uc4Enabled=ON). No cloud creds.
 */
const SPA_PORT = Number(process.env.LOCAL_SPA_PORT ?? 5183);

export default defineConfig({
  testDir: './tests/local',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${SPA_PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run local',
    url: `http://localhost:${SPA_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
