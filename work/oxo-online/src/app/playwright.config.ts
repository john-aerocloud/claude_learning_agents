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
 * IMP-009 L1 (OI-45) — PARALLEL WORKERS ENABLED: the two rate-limiting layers
 * that previously forced serialisation (EXP-009) are now both exempted for the
 * CI runner IP during any smoke run that goes through the add/remove cycle:
 *   Layer 1: CloudFront WAF rate rule — bypassed via the oxo-test-runner-ips
 *            IP-set exclusion (IMP-008, waf-runner-ip.js add/remove).
 *   Layer 2: $connect authorizer per-IP budget (20/5-min, oxo-connect-attempts
 *            table) — bypassed via EXEMPT#<ip> DDB item (s007a, same script).
 * With both layers exempt during smoke-ci, parallel workers no longer exhaust
 * any rate budget. workers:4 gives genuine parallelism on the ubuntu-latest
 * runner (2 vCPU) — Playwright schedules up to 4 tests concurrently. At 4
 * parallel WS specs (each opening ≤2 connections), peak simultaneous connections
 * = 8, well under the 20/5-min hard limit even in the un-exempted case.
 * retries:2 kept: transient network flakes on prod are real; retries guard them
 * without masking genuine failures (the exemption means retries no longer push
 * the runner over the WS budget).
 */
const prodUrl = process.env.PROD_URL;

export default defineConfig({
  testDir: './tests/smoke',
  // IMP-009 L1: both WAF + authorizer layers are now exempt for the runner IP
  // during smoke-ci (waf-runner-ip.js add/remove cycle). Serialisation was the
  // EXP-009 workaround; with both layers exempt it is an obsolete constraint.
  // workers:4 — 4 concurrent workers on ubuntu-latest (2 vCPU). This gives
  // genuine parallel execution; peak 8 simultaneous WS connects is safe even
  // without exemption (limit is 20/5-min). The exemption makes retries safe too.
  workers: process.env.CI ? 4 : undefined,
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
