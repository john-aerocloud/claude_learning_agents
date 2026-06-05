import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the post-deploy smoke suite.
 *
 * These tests run ONLY against the live production URL after a deploy — they do
 * not start a local server. The deployed URL is supplied via PROD_URL. If it is
 * absent the suite fails fast with a clear message rather than silently passing.
 */
const prodUrl = process.env.PROD_URL;

export default defineConfig({
  testDir: './tests/smoke',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: prodUrl,
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
