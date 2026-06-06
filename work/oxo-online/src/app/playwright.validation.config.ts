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
