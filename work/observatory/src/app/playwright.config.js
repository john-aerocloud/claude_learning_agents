import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright config for Observatory browser specs (CHK-2: chromium only).
// Specs live under e2e/. baseURL is the single Vite server on :5173.
//
// TOPOLOGY: ONE command (`npm run dev` in work/observatory/src/app) launches
// Vite on :5173 which serves BOTH the SPA (with HMR) AND all /api/* routes via
// the observatoryApiPlugin. Same-origin requests — no CORS needed.
//
// The read layer is pointed at a committed deterministic fixture repo
// (e2e/fixtures/repo) via OBSERVATORY_REPO_ROOT, so counts are stable
// (intake 3 / ready 1 starving / deploy 0 / rework 2) and the GEO/A11Y
// assertions never flap on the live repo.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = resolve(HERE, 'e2e', 'fixtures', 'repo');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      // Single Vite server: SPA + API on :5173.
      // Uses the fixture repo for deterministic counts.
      command: 'npm run dev',
      cwd: HERE,
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { OBSERVATORY_REPO_ROOT: FIXTURE_REPO },
    },
  ],
});
