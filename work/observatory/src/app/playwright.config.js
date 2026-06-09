import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright config for Observatory browser specs (CHK-2: chromium only).
// Specs live under e2e/. baseURL is the Vite dev server.
//
// UC-S002-3 wires the webServer block so the browser specs run a REAL browser
// against the FULL deployed path: the SPA dev server on :5173 AND the read
// layer on :3001 (the SPA client hardcodes :3001). The read layer is pointed at
// a committed deterministic fixture repo (e2e/fixtures/repo) via
// OBSERVATORY_REPO_ROOT, so counts are stable (intake 3 / ready 1 starving /
// deploy 0 / rework 2) and the GEO/A11Y assertions never flap on the live repo.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = resolve(HERE, 'e2e', 'fixtures', 'repo');
// src/app -> work/observatory (the read-layer package root) is two levels up.
const SERVER_PKG = resolve(HERE, '..', '..');

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
      // Read layer (:3001) against the committed fixture repo — deterministic data.
      command: 'npm run server',
      cwd: SERVER_PKG,
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { OBSERVATORY_REPO_ROOT: FIXTURE_REPO, PORT: '3001' },
    },
    {
      // SPA dev server (:5173) — the surface the real browser loads.
      command: 'npm run dev',
      cwd: HERE,
      port: 5173,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
