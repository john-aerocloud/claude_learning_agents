import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s005-h1-waf (WAF rate-limiting on CloudFront public endpoint)
 * Acceptance pinned:
 *   AC3.1 (CF burst block — sustained-rate: >100 POST /api/games over 300s window
 *          from single IP yields >= 1 HTTP 429 WAF block (custom block response,
 *          NOT SPA HTML) AND CloudWatch wafv2 BlockedRequests > 0 for rule
 *          oxo-cf-rate-limit in us-east-1).
 *
 * DEFECT-WAF-001 CONTRACT CHANGE (engineer, s005-h1-waf iter 7, 2026-06-06):
 *   The tester correctly evidenced that the spec/probe asserting HTTP 403 was
 *   right about the WAF FIRING but the 403 was being MASKED: CloudFront's
 *   CustomErrorResponses map 403 (and 404) -> 200 + /index.html (the SPA needs
 *   that for S3-origin 403s), so a WAF 403 block reached the client as 200 +
 *   SPA HTML — blocks were invisible at the HTTP level. FIX: the rate rule's
 *   Block action now returns a CUSTOM HTTP 429 (Too Many Requests), which is
 *   NOT in CloudFront's CustomErrorResponses list and therefore passes through
 *   untouched. The honest observable contract is now 429 (+ WAF body, not SPA
 *   HTML), so this spec asserts 429. The CF error mapping is unchanged.
 *   RESIDUAL: IP-reputation managed-group blocks still return 403 and are still
 *   CF-masked to SPA 200s; their observable channel is CloudWatch, not HTTP
 *   status (see waf-us-east-1-stack.ts comment). AC3.1 exercises the rate rule.
 *   AC1.4 (WebACL listed in us-east-1 with CLOUDFRONT scope; non-empty).
 *   AC1.5 (CF distribution webAclId non-empty and matches the listed WebACL ARN).
 *   DEPLOY-IDENTITY-WAF (WebACL tags: Project=oxo-online, Env=prod, ManagedBy=cdk).
 *   WALKING-SKELETON-WAF step 3 (normal flow: POST /api/games 201 succeeds
 *          unblocked after the rate window expires — noted if still in-window).
 * Relevancy: pinned (standing WAF regression).
 * Retire when: CloudFront WAF WebACL removed from OxoOnlineProd; or rate rule
 *   replaced by a fundamentally different mechanism; or CF distribution replaced.
 * Surface: live AWS (WAFv2 + CloudWatch CLI read-only, us-east-1) + PROD_URL.
 * Skips gracefully: AWS-dependent assertions skip when credentials absent.
 *
 * RATE-RULE TIMING NOTE (engineer finding, s005-h1-waf ledger 2026-06-06):
 *   The WAFv2 CLOUDFRONT rate-based rule (Limit=100, EvaluationWindowSec=300,
 *   AggregateKeyType=IP) uses a SLIDING window and detects rate violations
 *   PERIODICALLY (WAF evaluates ~every 30s), NOT per-request. A fast burst
 *   of 160 requests completes before the evaluation cycle fires; therefore the
 *   walking-skeleton fast-burst probe found 0 BlockedRequests. This spec
 *   corrects for that by PACING requests (1 req/1.5s across ~165s) so that
 *   when WAF evaluates mid-burst, >100 requests are in the 300s window AND
 *   subsequent requests arrive to receive the Block action.
 *
 * If after an honest sustained run the rule still never fires (wafBlocked=0
 * AND CloudWatch BlockedRequests=0), this spec fails with EVIDENCE: it is NOT
 * a pass. The spec records the finding so engineering can investigate whether
 * the rate limit configuration, WAF evaluation frequency, or CloudWatch metric
 * delay is the cause — then a fix is required before the slice is DONE.
 *
 * BROWSER-TRANSPORT NOTE (process v27): WAF acts below the browser-layer
 *   (CSP connect-src, runtime config). A Node fetch probe correctly exercises
 *   the WAF IP-rate mechanism (§PROBE-CLIENT JUSTIFICATION in waf-burst-probe.js).
 *   Browser-level transport coverage (CSP, config) is in the smoke suite.
 *
 * CloudWatch metric for BlockedRequests:
 *   Namespace: AWS/WAFV2
 *   Dimensions: WebACL=oxo-online-cf-global, Rule=oxo-cf-rate-limit, Region=CloudFront
 *   Region (API call): us-east-1
 *   Stat: Sum, Period: 300 (5 min)
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const PROFILE = process.env.AWS_PROFILE ?? 'dev-int';

// CloudFront WAF is always in us-east-1 regardless of the app's home region.
const WAF_REGION = 'us-east-1';

const WAF_ACL_NAME = 'oxo-online-cf-global';
const WAF_ACL_ID = 'd4cb415c-ea90-4996-889e-4a6da778e2ba';
const WAF_ACL_ARN =
  'arn:aws:wafv2:us-east-1:817047731316:global/webacl/oxo-online-cf-global/d4cb415c-ea90-4996-889e-4a6da778e2ba';
const CF_DIST_ID = 'E519HYABC57ZX';

const RATE_RULE_NAME = 'RateLimitPerIp';
const RATE_RULE_METRIC = 'oxo-cf-rate-limit';
const RATE_RULE_LIMIT = 100;
const RATE_RULE_WINDOW_SEC = 300;

// Sustained probe configuration:
// 110 requests at 1500ms pace = ~165s burst duration.
// After 100 requests: ~15 more requests arrive while WAF's evaluation window
// still holds all 110 in it, giving WAF a chance to fire the block rule.
const PROBE_COUNT = 110;
const PROBE_PACE_MS = 1500;
const PROBE_TIMEOUT_MS = 12000;
const PROBE_COOLDOWN_MS = 5000;

// Total probe time: 110 * 1500ms + 5000ms = ~170s. Plus CloudWatch polling
// (up to 2 min after burst). Set a generous per-test timeout.
// Playwright default is 30s; override here for this long-running spec.
const TEST_TIMEOUT_MS = 600_000; // 10 minutes

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// The probe script lives at work/oxo-online/scripts/waf-sustained-probe.js
// relative to the project root. The spec runs with cwd=work/oxo-online/src/app.
// Go up four levels: tests/validation -> tests -> src/app -> src -> oxo-online.
// Wait: spec dir is tests/validation; up from there: src/app, src, oxo-online, work.
// Actually: __dirname = …/src/app/tests/validation
// ../.. = src/app; ../../.. = src; ../../../.. = oxo-online; ../../../../.. = work
// ../../../../.. + /scripts/waf-sustained-probe.js won't work; we need project root.
// Project root = 6 levels up from __dirname.
// __dirname: work/oxo-online/src/app/tests/validation  (6 segments from project root)
const PROBE_SCRIPT = path.resolve(__dirname, '../../../../scripts/waf-sustained-probe.js');

/** Run an aws CLI call, return parsed JSON. Throws on non-zero exit. */
function aws(args: string[]): unknown {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', WAF_REGION, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.trim() ? JSON.parse(out) : {};
}

/** True iff AWS credentials are usable right now. */
function awsAvailable(): boolean {
  try {
    aws(['sts', 'get-caller-identity']);
    return true;
  } catch {
    return false;
  }
}

const AWS_OK = awsAvailable();
const SKIP_MSG =
  `AWS credentials absent/expired for profile "${PROFILE}". ` +
  `Run: aws sso login --profile ${PROFILE}. ` +
  `WAF identity assertions skipped; sustained-rate probe still runs if PROD_URL set.`;

// ─────────────────────────────────────────────────────────────────────────────
// AC1.4 + AC1.5 + DEPLOY-IDENTITY-WAF: WebACL existence + CF association + tags
// These are fast AWS-only checks; run before the long sustained-rate test.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('s005-h1-waf AC1.x — WAF WebACL existence, association, identity', () => {
  test.skip(!AWS_OK, SKIP_MSG);

  test('AC1.4 — CLOUDFRONT-scope WebACL listed in us-east-1 with correct name', () => {
    const list = aws([
      'wafv2', 'list-web-acls', '--scope', 'CLOUDFRONT',
    ]) as { WebACLs?: Array<{ Name: string; Id: string; ARN: string }> };

    const acls = list.WebACLs ?? [];
    const found = acls.find((a) => a.Name === WAF_ACL_NAME);

    expect(found, `WebACL "${WAF_ACL_NAME}" must be listed in us-east-1 CLOUDFRONT scope`).toBeTruthy();
    expect(found!.ARN, 'WebACL ARN must match the pinned ARN').toBe(WAF_ACL_ARN);
    expect(found!.Id, 'WebACL Id must match the pinned Id').toBe(WAF_ACL_ID);

    console.log(`AC1.4 PASS: WebACL="${WAF_ACL_NAME}" ARN=${WAF_ACL_ARN}`);
  });

  test('AC1.5 — CloudFront distribution webAclId is non-empty and matches WebACL ARN', () => {
    // CloudFront is a global service; its CLI API defaults to us-east-1.
    const dist = aws([
      'cloudfront', 'get-distribution', '--id', CF_DIST_ID,
    ]) as {
      Distribution: {
        DistributionConfig: { WebACLId?: string };
        Status: string;
      };
    };

    const webAclId = dist.Distribution.DistributionConfig.WebACLId;
    expect(webAclId, 'CloudFront distribution WebACLId must be non-empty').toBeTruthy();
    expect(webAclId, 'CloudFront distribution WebACLId must equal the WAF ACL ARN').toBe(
      WAF_ACL_ARN,
    );

    console.log(`AC1.5 PASS: CF dist ${CF_DIST_ID} WebACLId=${webAclId?.substring(0, 60)}…`);
  });

  test('DEPLOY-IDENTITY-WAF — WebACL has rate rule Limit<=100, IP aggregate, Block action', () => {
    const detail = aws([
      'wafv2', 'get-web-acl',
      '--name', WAF_ACL_NAME,
      '--id', WAF_ACL_ID,
      '--scope', 'CLOUDFRONT',
    ]) as {
      WebACL: {
        DefaultAction: Record<string, unknown>;
        Rules: Array<{
          Name: string;
          Statement?: {
            RateBasedStatement?: {
              Limit: number;
              EvaluationWindowSec: number;
              AggregateKeyType: string;
            };
          };
          Action?: {
            Block?: { CustomResponse?: { ResponseCode?: number } };
          };
          VisibilityConfig: { MetricName: string };
        }>;
      };
    };

    const acl = detail.WebACL;

    // Default action must be Allow.
    expect(
      acl.DefaultAction,
      'WebACL default action must be Allow (not Block)',
    ).toHaveProperty('Allow');

    // Rate rule must exist with correct parameters.
    const rateRule = acl.Rules.find((r) => r.Name === RATE_RULE_NAME);
    expect(rateRule, `Rate rule "${RATE_RULE_NAME}" must exist`).toBeTruthy();

    const rbs = rateRule!.Statement?.RateBasedStatement;
    expect(rbs, 'Rate rule must have a RateBasedStatement').toBeTruthy();
    expect(
      rbs!.Limit,
      `Rate rule Limit must be <= ${RATE_RULE_LIMIT}`,
    ).toBeLessThanOrEqual(RATE_RULE_LIMIT);
    expect(
      rbs!.EvaluationWindowSec,
      `Rate rule EvaluationWindowSec must be ${RATE_RULE_WINDOW_SEC}`,
    ).toBe(RATE_RULE_WINDOW_SEC);
    expect(rbs!.AggregateKeyType, 'Rate rule AggregateKeyType must be IP').toBe('IP');

    // Action must be Block.
    expect(rateRule!.Action, 'Rate rule action must be Block').toHaveProperty('Block');

    // DEFECT-WAF-001: the Block action must carry a CUSTOM response with HTTP
    // 429, so the block is NOT CF-error-mapped to 200 + SPA HTML. 429 is not in
    // the CloudFront CustomErrorResponses list (403/404) and is the honest
    // rate-limit status — this is the observable contract clients/probes see.
    expect(
      rateRule!.Action?.Block?.CustomResponse?.ResponseCode,
      'Rate rule Block must return a custom ResponseCode 429 (not the default 403, which CF masks to 200+SPA)',
    ).toBe(429);

    // Metric name must match the expected value (for CloudWatch correlation).
    expect(
      rateRule!.VisibilityConfig.MetricName,
      `Rate rule MetricName must be "${RATE_RULE_METRIC}"`,
    ).toBe(RATE_RULE_METRIC);

    // IP reputation managed rule must also be present.
    const repRule = acl.Rules.find(
      (r) =>
        r.Statement &&
        JSON.stringify(r.Statement).includes('AWSManagedRulesAmazonIpReputationList'),
    );
    expect(repRule, 'AWSManagedRulesAmazonIpReputationList rule must be present').toBeTruthy();

    console.log(
      `DEPLOY-IDENTITY-WAF PASS: defaultAction=Allow rateLimit=${rbs!.Limit}/` +
      `${rbs!.EvaluationWindowSec}s aggregate=${rbs!.AggregateKeyType} action=Block ` +
      `metric=${rateRule!.VisibilityConfig.MetricName}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC3.1 — Sustained-rate probe: >100 POST /api/games paced across the 300s
// window. Asserts >= 1 HTTP 429 WAF block returned to the client AND
// CloudWatch BlockedRequests > 0 for rule oxo-cf-rate-limit in us-east-1.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('s005-h1-waf AC3.1 — sustained-rate WAF block', () => {
  // This test is intentionally long: ~170s probe + CloudWatch polling.
  // The test timeout is set per-test to 10 minutes.
  test.skip(
    !PROD_URL,
    'PROD_URL is not set — AC3.1 requires a live CloudFront endpoint.',
  );

  test(
    'AC3.1 — paced burst (110 req @ 1.5s) triggers >= 1 WAF 429 block; CloudWatch BlockedRequests > 0',
    async () => {
      // Set an extended timeout for this one long-running test.
      test.setTimeout(TEST_TIMEOUT_MS);

      // ── Step 1: run the sustained-rate probe ──────────────────────────────
      console.log(
        `[AC3.1] Starting sustained probe: ${PROBE_COUNT} req @ ${PROBE_PACE_MS}ms pace ` +
        `→ est. ${Math.round((PROBE_COUNT * PROBE_PACE_MS) / 1000)}s burst ` +
        `to ${PROD_URL}/api/games`,
      );

      const probeStart = new Date();

      let rawOutput: string;
      try {
        rawOutput = execFileSync(
          'node',
          [
            PROBE_SCRIPT,
            '--base-url', PROD_URL,
            '--count', String(PROBE_COUNT),
            '--pace-ms', String(PROBE_PACE_MS),
            '--timeout', String(PROBE_TIMEOUT_MS),
            '--cooldown', String(PROBE_COOLDOWN_MS),
          ],
          {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            // Script takes ~170s; allow 300s for the child process.
            timeout: 300_000,
          },
        );
      } catch (err) {
        throw new Error(`waf-sustained-probe script failed: ${String(err)}`);
      }

      const probeEnd = new Date();
      let probe: {
        sent: number;
        status2xx: number;
        status429: number;
        status5xx: number;
        statusOther: number;
        wafBlocked: number;
        durationMs: number;
        normalFlow: { ok: boolean; status: number; hasGamePayload: boolean; note?: string };
        pass: boolean;
        error?: string;
      };

      try {
        probe = JSON.parse(rawOutput.trim());
      } catch {
        throw new Error(`waf-sustained-probe returned non-JSON output: ${rawOutput.substring(0, 200)}`);
      }

      if (probe.error) {
        throw new Error(`waf-sustained-probe error: ${probe.error}`);
      }

      console.log(
        `[AC3.1] Probe result: sent=${probe.sent} 2xx=${probe.status2xx} ` +
        `429=${probe.status429} 5xx=${probe.status5xx} other=${probe.statusOther} ` +
        `wafBlocked=${probe.wafBlocked} durationMs=${probe.durationMs}`,
      );
      console.log(
        `[AC3.1] normalFlow: ok=${probe.normalFlow.ok} status=${probe.normalFlow.status}` +
        (probe.normalFlow.note ? ` note="${probe.normalFlow.note}"` : ''),
      );

      // ── Step 2: assert >= 1 HTTP 429 WAF block from the probe ─────────────
      // The create handler (oxo-game-fn) NEVER returns 429; any 429 in the burst
      // is a WAF rate-limit block (custom block response, DEFECT-WAF-001). 429 is
      // NOT CF-error-mapped (CF only intercepts 403/404), so the block reaches the
      // client honestly. Distinguish from Lambda 5xx (concurrency exhaustion).
      expect(
        probe.wafBlocked,
        `AC3.1 FAIL: Expected >= 1 WAF 429 block from ${probe.sent} sustained requests ` +
        `(2xx=${probe.status2xx}, 5xx=${probe.status5xx}). ` +
        `0 WAF blocks = rate rule did not fire within the probe window. ` +
        `Engineering action: verify WAF evaluation frequency, rate rule configuration, ` +
        `or increase probe count/duration. Lambda 5xx are NOT WAF blocks.`,
      ).toBeGreaterThanOrEqual(1);

      // ── Step 3: assert CloudWatch BlockedRequests > 0 (if creds available) ─
      if (AWS_OK) {
        // CloudWatch WAFv2 metrics for CLOUDFRONT-scope are in us-east-1.
        // Dimension: WebACL=<name>, Rule=<metric-name>, Region=CloudFront.
        // We poll for up to 2 minutes after the burst ends to account for metric
        // propagation latency (CloudWatch WAFv2 metrics can lag ~1-2 min).
        const pollStart = Date.now();
        const POLL_INTERVAL_MS = 30_000; // 30s between checks
        const POLL_MAX_MS = 120_000;    // 2 min total
        let cwBlockedRequests = 0;

        // Build the time window: from 5 min before probe start to now + buffer.
        // WAFv2 metrics are published per 5-minute period; we query the last 10 min.
        const metricEndTime = new Date(probeEnd.getTime() + 90_000); // +90s buffer
        const metricStartTime = new Date(probeStart.getTime() - 300_000); // -5min before

        console.log(
          `[AC3.1] Polling CloudWatch BlockedRequests (rule=${RATE_RULE_METRIC}) ` +
          `window=${metricStartTime.toISOString()} → ${metricEndTime.toISOString()}`,
        );

        while (Date.now() - pollStart < POLL_MAX_MS) {
          try {
            const cwResult = aws([
              'cloudwatch', 'get-metric-statistics',
              '--namespace', 'AWS/WAFV2',
              '--metric-name', 'BlockedRequests',
              '--dimensions',
              `Name=WebACL,Value=${WAF_ACL_NAME}`,
              `Name=Rule,Value=${RATE_RULE_METRIC}`,
              'Name=Region,Value=CloudFront',
              '--start-time', metricStartTime.toISOString(),
              '--end-time', metricEndTime.toISOString(),
              '--period', '300',
              '--statistics', 'Sum',
            ]) as { Datapoints?: Array<{ Sum: number; Timestamp: string }> };

            const datapoints = cwResult.Datapoints ?? [];
            cwBlockedRequests = datapoints.reduce((sum, dp) => sum + (dp.Sum ?? 0), 0);

            console.log(
              `[AC3.1] CloudWatch poll: ${datapoints.length} datapoints, ` +
              `total BlockedRequests=${cwBlockedRequests}`,
            );

            if (cwBlockedRequests > 0) break;

            // Not yet; wait and try again.
            const remaining = POLL_MAX_MS - (Date.now() - pollStart);
            if (remaining > POLL_INTERVAL_MS) {
              await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            } else {
              break;
            }
          } catch (err) {
            // CloudWatch call failed — log but don't fail the test on it;
            // the HTTP-level 429 assertion above is the primary evidence.
            console.log(`[AC3.1] CloudWatch poll error (non-fatal): ${String(err)}`);
            break;
          }
        }

        expect(
          cwBlockedRequests,
          `AC3.1 FAIL: CloudWatch BlockedRequests=0 for rule="${RATE_RULE_METRIC}" ` +
          `after ${Math.round(POLL_MAX_MS / 1000)}s of polling. ` +
          `HTTP probe saw wafBlocked=${probe.wafBlocked} — metric publication lag may exceed ` +
          `the poll window, or the rule is not emitting metrics correctly. ` +
          `Check CloudWatch console: namespace=AWS/WAFV2 dimensions=WebACL=${WAF_ACL_NAME},Rule=${RATE_RULE_METRIC},Region=CloudFront`,
        ).toBeGreaterThan(0);

        console.log(
          `[AC3.1] PASS: wafBlocked=${probe.wafBlocked} HTTP 429s received; ` +
          `CloudWatch BlockedRequests=${cwBlockedRequests} (rule=${RATE_RULE_METRIC})`,
        );
      } else {
        // No AWS creds: HTTP-level evidence is sufficient for this assertion.
        console.log(
          `[AC3.1] AWS creds absent — CloudWatch assertion skipped. ` +
          `HTTP evidence: wafBlocked=${probe.wafBlocked} (primary assertion passed above).`,
        );
      }

      // ── Step 4: normal-flow note (not a hard assertion — may still be in window) ─
      // The walking-skeleton step 3 requirement: one clean POST must succeed after
      // the rate window expires. If the clean request is still 429, log the note;
      // the operator should verify normal-flow transparency after the 300s window.
      if (!probe.normalFlow.ok) {
        console.log(
          `[AC3.1] NORMAL-FLOW NOTE: clean request returned status=${probe.normalFlow.status} ` +
          `(expected 201). ${probe.normalFlow.note ?? 'May still be in the rate window — verify after 5 min.'}`,
        );
      } else {
        console.log(
          `[AC3.1] Normal flow confirmed: clean POST returned 201 with game payload.`,
        );
      }
    },
  );
});
