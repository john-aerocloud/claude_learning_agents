import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the s006 WALKING-SKELETON suite (§17, process v25/v27).
 *
 * Drives ONE real move through the FULL deployed path in TWO REAL BROWSERS
 * (not a node ws/fetch probe — those run below CSP/transport and give a FALSE
 * GREEN). It is a committed regression: any console error / blocked connection
 * / undefined config discovered live becomes a standing failing spec here.
 *
 * Runs against the live production CloudFront URL (PROD_URL). The SPA does its
 * own create (POST /api/games) + join, so the skeleton exercises the real
 * authorizer (host wsToken / guest code), the real WS relay, and the real
 * conditional move write end-to-end. Serial single-worker so the two contexts'
 * WS connects stay within the per-IP authorizer budget (OI-32).
 */
const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';

export default defineConfig({
  testDir: './tests/skeleton',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: PROD_URL,
    trace: 'on-first-retry',
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
