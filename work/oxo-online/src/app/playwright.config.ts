import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the post-deploy smoke suite.
 *
 * These tests run ONLY against the live production URL after a deploy — they do
 * not start a local server. The deployed URL is supplied via PROD_URL. If it is
 * absent the suite fails fast with a clear message rather than silently passing.
 *
 * OI-25 smoke gate (principles/01): the sha-check test in shell.spec.ts asserts
 * that meta[name="build-sha"].content == process.env.DEPLOY_SHA before all
 * behavioural assertions. This ensures CDN propagation is complete (§39-correct;
 * not sleep/wait). If DEPLOY_SHA is absent the gate is skipped (local dev).
 *
 * OI-32 (EXP-009) — PARTIAL: the smoke suite includes WS tests that open 2–3
 * WebSocket connections each. The $connect authorizer (s005-h2) tracks per-IP
 * rolling connection counts (ConnectAttempts DDB, 5-min TTL). Empirical finding
 * (s006-cap, 2026-06-07): reducing to workers:1 causes per-IP WS counter
 * exhaustion across sequential tests, causing cascading 30s timeouts on WS
 * pairing tests (F6, F7). The previous parallel default (2 CPUs → 1 worker in
 * CI, all 43 tests in 34s) was PASSING 41/42 with the authorizer counter
 * staying within bounds. The true OI-32 fix requires the engineer to raise the
 * per-IP authorizer limit for CI runner IPs, or the tester to add inter-test
 * cool-down delays in WS specs. Tracked as OI-32-FOLLOW-UP.
 *
 * retries:2 restored: without retries, the F3/T4 pre-existing defect (message
 * mismatch) fails fast but reveals the cascade differently. With retries:2, the
 * failing retry opens an extra WS connection and can hit the authorizer counter
 * limit sooner — see EXP-009 notes. This is a known trade-off; the underlying
 * fix is the authorizer per-IP limit or test isolation.
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
