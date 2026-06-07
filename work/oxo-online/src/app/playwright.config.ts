import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the post-deploy smoke suite.
 *
 * These tests run ONLY against the live production URL after a deploy — they do
 * not start a local server. The deployed URL is supplied via PROD_URL. If it is
 * absent the suite fails fast with a clear message rather than silently passing.
 *
 * OI-32 (EXP-009): workers:1 serialises all smoke tests. The WS API enforces
 * 20 connects / 5 min per IP (WAF rate rule). With 6 spec files and fullyParallel
 * true, up to 7 workers fired simultaneously — each pairing test opens 2–3 WS
 * connections, exhausting the budget and causing false-red rate-block failures
 * (observed s005-h2 evidence). Serialising eliminates the burst; smoke runtime
 * increases but correctness is restored.
 *
 * OI-25 smoke gate (principles/01): the sha-check test in shell.spec.ts asserts
 * that meta[name="build-sha"].content == process.env.DEPLOY_SHA before all
 * behavioural assertions. This ensures CDN propagation is complete (§39-correct;
 * not sleep/wait). If DEPLOY_SHA is absent the gate is skipped (local dev).
 */
const prodUrl = process.env.PROD_URL;

export default defineConfig({
  testDir: './tests/smoke',
  // OI-32: serialise all smoke workers — prevents WS rate-limit exhaustion.
  // The WAF WS ACL allows 20 connects/5min per IP; parallel workers breach this
  // with legitimate pairing tests. workers:1 keeps the burst within budget.
  //
  // retries:0 is intentional in CI: the smoke suite includes WS tests that
  // time out when the WAF rate limit is hit. With retries>0 each retry cycle
  // adds 30s×N more time in the WAF window, compounding rate-limit exhaustion
  // and causing cascading failures on subsequent tests. Fail fast; the defect
  // owner (engineer/tester) fixes the root cause rather than the pipeline
  // masking it with retries. OI-32-follow-up: remove when F3/T4 message-
  // mismatch defect is resolved and smoke reliably passes without rate-block.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
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
