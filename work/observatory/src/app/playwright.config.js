import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright config for Observatory browser specs (CHK-2: chromium only).
// Specs live under e2e/. baseURL is the single consolidated server on :3001.
//
// TOPOLOGY: ONE server (npm run dev from the observatory package root) serves
// both the API (/api/*) and the Vite-transformed SPA on port :3001. The
// SPA client uses relative URLs (API_BASE = '') — same-origin, no CORS.
// The read layer is pointed at a committed deterministic fixture repo
// (e2e/fixtures/repo) via OBSERVATORY_REPO_ROOT, so counts are stable
// (intake 3 / ready 1 starving / deploy 0 / rework 2) and the GEO/A11Y
// assertions never flap on the live repo.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPO = resolve(HERE, 'e2e', 'fixtures', 'repo');
// src/app -> work/observatory (the observatory package root) is two levels up.
const SERVER_PKG = resolve(HERE, '..', '..');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3001',
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
      // Single consolidated server: Express API + Vite SPA on :3001.
      // Uses the fixture repo for deterministic queue counts.
      command: 'npm run dev',
      cwd: SERVER_PKG,
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { OBSERVATORY_REPO_ROOT: FIXTURE_REPO, PORT: '3001' },
    },
  ],
});
