import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the validation-as-code suite (process v16 §35, IMP-002).
 *
 * Runs the committed validation specs under `tests/validation/` SEPARATELY from
 * the post-deploy smoke suite (`tests/smoke/`, playwright.config.ts). These specs
 * replace the tester's ad-hoc curl/CLI checks: they pin acceptance + security
 * cases as re-runnable code, exercised against the live production surface.
 *
 *   - API-contract specs use Playwright's request context against PROD_URL.
 *   - AWS-policy specs shell out to the read-only AWS CLI (allowlisted patterns)
 *     and self-skip when credentials are absent, so the suite stays runnable
 *     API-only.
 *
 * PROD_URL defaults to the production CloudFront distribution so the suite is
 * runnable with a bare `npx playwright test --config=playwright.validation.config.ts`.
 */
const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';

export default defineConfig({
  testDir: './tests/validation',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // workers: 1 is required because the AC3.1 spec issues a sustained flood that
  // trips the WAF rate rule (300s window, 100 req limit). If other specs run
  // concurrently in parallel workers they POST /api/games during the probe and
  // receive 429 instead of 201. Serial execution means the flood spec (last
  // alphabetically: slice005-h1-waf-ac3.1.spec.ts) runs AFTER the other specs
  // complete their clean-request assertions. The WAF window then expires before
  // the next run. Tradeoff: +10min total for the AC3.1 probe; acceptable for a
  // standing WAF-regression spec that runs on-demand (not in the hot path).
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: PROD_URL,
    trace: 'off',
    ignoreHTTPSErrors: false,
  },
  // No browser project needed — these specs use the request context and Node
  // child processes, not a rendered page. A single chromium project keeps the
  // runner happy without launching a browser per test.
  projects: [{ name: 'validation' }],
});
