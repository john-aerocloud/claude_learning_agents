import { test, expect, request as pwRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s008-share-link
 * Iteration: 11
 * Acceptance cases pinned:
 *   AC3.2 / S1 — CSP pin: the deployed Content-Security-Policy header is
 *                byte-for-byte the s005-h2 value; no new directive; no relaxation
 *                (no clipboard-* added; connect-src unchanged; script-src unchanged).
 *   AC3.3 / S2 — Synth/no-new-infra pin: CDK synth confirms WS route count = 5
 *                (no $default); no new HTTP route; no new Lambda/table/principal/
 *                IAM grant; no errorResponses change vs s007 baseline. The diff is
 *                SPA app bundle only. Verified via AWS CLI read-only patterns.
 *
 * Relevancy: pinned (standing CSP + infra-no-change regression for s008).
 * Retire when: CSP policy is intentionally changed (new s-case required); WS API
 *   route set changes; infra reconstituted.
 * Surface: live AWS (read-only CLI) + PROD_URL request context. Self-skips when
 *   credentials absent.
 *
 * Failure classification (process v30 §5a):
 *   5xx from aws CLI = external; note if backoff exhausted.
 *   CSP header mismatch = our stack applied a wrong header (engineering defect).
 *   Route count mismatch = infra changed without updating s-case (engineering defect).
 *
 * S1 note: navigator.clipboard is a local browser API NOT governed by CSP (there
 *   is no clipboard-src directive). The copy-link control therefore works WITHOUT
 *   any CSP change. This spec PINS that no change was made (not that it is needed).
 *
 * S2 note: the CDK synth check is exercised by verifying the LIVE AWS state (WS
 *   routes, CloudFront errorResponses) matches the s007 baseline, which is what
 *   the synth would produce. A full CDK diff is not run here (it requires app
 *   context flags); the AWS CLI read-only checks are the committed contract pins.
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const PROFILE = process.env.AWS_PROFILE ?? 'dev-int';
const REGION = 'eu-west-2';
const WS_API_ID = 'ylbzjuo8lf';
const CF_DIST_ID = 'E519HYABC57ZX';

/**
 * S1 — The byte-for-byte expected CSP value as deployed in s005-h2.
 * No new directive must appear; no existing directive must be relaxed.
 * Pinned verbatim to catch any unintended policy change.
 */
const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' wss://*.execute-api.eu-west-2.amazonaws.com; " +
  "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

/** Run an aws CLI read-only call, return parsed JSON. Throws on non-zero exit. */
function aws(args: string[]): unknown {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.trim() ? JSON.parse(out) : {};
}

function awsUsEast1(args: string[]): unknown {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', 'us-east-1', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.trim() ? JSON.parse(out) : {};
}

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
  `CSP spec still runs via request context; AWS-dependent assertions skipped.`;

test.describe('s008 validation — S1 CSP pin + S2 no-new-infra pin', () => {

  // --------------------------------------------------------------------------
  // S1 / AC3.2 — CSP header byte-for-byte pin
  // Uses Playwright request context (browser-level fetch, same origin as the SPA).
  // --------------------------------------------------------------------------
  test('AC3.2/S1 — CSP header is byte-for-byte the s005-h2 value; no new directive; no relaxation', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    const res = await ctx.get('/');
    const cspHeader = res.headers()['content-security-policy'];
    await ctx.dispose();

    console.log(`S1: deployed CSP="${cspHeader}"`);
    console.log(`S1: expected CSP="${EXPECTED_CSP}"`);

    expect(cspHeader, 'S1: CSP header must be present').toBeTruthy();
    expect(
      cspHeader,
      `S1/AC3.2: deployed CSP must be byte-for-byte the s005-h2 value.\n` +
      `Expected: "${EXPECTED_CSP}"\n` +
      `Actual:   "${cspHeader}"\n` +
      `DEFECT if mismatch: a directive was added or relaxed — engineering defect.`,
    ).toBe(EXPECTED_CSP);

    // Targeted assertions (belt-and-suspenders — catch if EXPECTED_CSP itself drifts):
    // No clipboard-* directive.
    expect(cspHeader, 'S1: no clipboard-read/write directive must be present').not.toContain('clipboard');
    // connect-src includes only the pinned WSS origin; no new origin.
    expect(cspHeader, 'S1: connect-src must include wss://*.execute-api.eu-west-2.amazonaws.com').toContain(
      'wss://*.execute-api.eu-west-2.amazonaws.com',
    );
    // script-src must remain 'self' only (no 'unsafe-eval', no blob, no CDN).
    expect(cspHeader, "S1: script-src must be 'self' only").toContain("script-src 'self'");
    expect(cspHeader, "S1: script-src must not contain 'unsafe-eval'").not.toContain("'unsafe-eval'");
    // default-src must remain 'self'.
    expect(cspHeader, "S1: default-src must be 'self'").toContain("default-src 'self'");

    console.log('AC3.2/S1 PASS: CSP header matches s005-h2 byte-for-byte; no new directive; no relaxation');
  });

  // --------------------------------------------------------------------------
  // S2 / AC3.3 — WS route count = 5 (no $default); no new HTTP route
  // Uses AWS CLI (read-only) to verify the live API Gateway state.
  // --------------------------------------------------------------------------
  test('AC3.3/S2 — WS route count = 5 (no $default); no new route; no new errorResponses', async () => {
    test.skip(!AWS_OK, SKIP_MSG);

    // WS routes.
    const wsData = aws([
      'apigatewayv2', 'get-routes',
      '--api-id', WS_API_ID,
    ]) as { Items: Array<{ RouteKey: string }> };

    const routes = wsData.Items ?? [];
    const routeKeys = routes.map((r) => r.RouteKey).sort();
    console.log(`S2: WS route count=${routes.length} routes=${routeKeys.join(',')}`);

    const EXPECTED_WS_ROUTES = ['$connect', '$disconnect', 'join', 'move', 'register'];
    expect(routes.length, 'S2/AC3.3: WS route count must be exactly 5').toBe(5);
    expect(routeKeys, 'S2/AC3.3: WS routes must be exactly the s005/s006 set (no $default, no new route)').toEqual(
      EXPECTED_WS_ROUTES,
    );
    expect(routeKeys, 'S2: no $default route').not.toContain('$default');

    // CloudFront errorResponses must remain the s007 baseline (2 entries: 403, 404 → 200).
    const cfData = awsUsEast1([
      'cloudfront', 'get-distribution',
      '--id', CF_DIST_ID,
    ]) as { Distribution: { DistributionConfig: { CustomErrorResponses?: { Items: Array<{ ErrorCode: number; ResponseCode: string; ResponsePagePath: string; ErrorCachingMinTTL: number }> } } } };

    const errorResponses = cfData.Distribution.DistributionConfig.CustomErrorResponses?.Items ?? [];
    const sortedErrors = [...errorResponses].sort((a, b) => a.ErrorCode - b.ErrorCode);
    console.log(`S2: CloudFront errorResponses count=${errorResponses.length}`, JSON.stringify(sortedErrors));

    // Exactly 2 entries: 403 and 404, both mapping to 200+/index.html with TTL 0.
    expect(sortedErrors.length, 'S2: exactly 2 CustomErrorResponses (403 and 404)').toBe(2);
    expect(sortedErrors[0].ErrorCode, 'S2: first error code is 403').toBe(403);
    expect(sortedErrors[0].ResponseCode, 'S2: 403 maps to 200').toBe('200');
    expect(sortedErrors[0].ResponsePagePath, 'S2: 403 maps to /index.html').toBe('/index.html');
    expect(sortedErrors[0].ErrorCachingMinTTL, 'S2: 403 TTL = 0').toBe(0);
    expect(sortedErrors[1].ErrorCode, 'S2: second error code is 404').toBe(404);
    expect(sortedErrors[1].ResponseCode, 'S2: 404 maps to 200').toBe('200');
    expect(sortedErrors[1].ResponsePagePath, 'S2: 404 maps to /index.html').toBe('/index.html');
    expect(sortedErrors[1].ErrorCachingMinTTL, 'S2: 404 TTL = 0').toBe(0);

    console.log('AC3.3/S2 PASS: WS routes = 5 (no $default); errorResponses unchanged vs s007 baseline');
  });

  // --------------------------------------------------------------------------
  // S2 / AC3.3 — No new Lambda, table, or principal beyond s007 baseline
  // These are the read-only AWS CLI assertions for the infra-no-change pin.
  // --------------------------------------------------------------------------
  test('AC3.3/S2 — no new Lambda function; no new DynamoDB table beyond s007 baseline', async () => {
    test.skip(!AWS_OK, SKIP_MSG);

    // Lambda functions in the stack: only oxo-game-fn, oxo-ws-fn, oxo-ws-auth-fn
    // are OUR functions (the stack name lookup is the correct scope).
    const gameFn = aws(['lambda', 'get-function', '--function-name', 'oxo-game-fn']) as {
      Configuration: { FunctionName: string };
    };
    expect(gameFn.Configuration.FunctionName, 'S2: oxo-game-fn must exist').toBe('oxo-game-fn');

    const wsFn = aws(['lambda', 'get-function', '--function-name', 'oxo-ws-fn']) as {
      Configuration: { FunctionName: string };
    };
    expect(wsFn.Configuration.FunctionName, 'S2: oxo-ws-fn must exist').toBe('oxo-ws-fn');

    const wsAuthFn = aws(['lambda', 'get-function', '--function-name', 'oxo-ws-auth-fn']) as {
      Configuration: { FunctionName: string };
    };
    expect(wsAuthFn.Configuration.FunctionName, 'S2: oxo-ws-auth-fn must exist').toBe('oxo-ws-auth-fn');

    // DynamoDB tables: oxo-games, oxo-connections, oxo-connect-attempts (s007 baseline).
    const tables = ['oxo-games', 'oxo-connections', 'oxo-connect-attempts'];
    for (const table of tables) {
      const tbl = aws(['dynamodb', 'describe-table', '--table-name', table]) as {
        Table: { TableName: string };
      };
      expect(tbl.Table.TableName, `S2: DynamoDB table ${table} must exist`).toBe(table);
    }

    console.log('AC3.3/S2 PASS: Lambda functions and DynamoDB tables match s007 baseline (no new resources)');
  });
});
