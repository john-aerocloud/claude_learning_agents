import { test, expect, request as pwRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * =============================================================================
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * -----------------------------------------------------------------------------
 * Slice:            004-create-game
 * Acceptance pinned: T1 (persisted half — DynamoDB item shape: status='waiting',
 *                        ttl ~86400s ahead),
 *                    S1 (stored half — stored item is server-generated for a game
 *                        created in this run),
 *                    T2 (/api/* CloudFront behaviour uses managed CachingDisabled),
 *                    T3 (oxo-game-fn role grants dynamodb:PutItem on the oxo-games
 *                        ARN only — no wildcard resource),
 *                    T5 (oxo-game-fn reserved concurrency > 0).
 * Relevancy:        pinned (standing infra/security regression).
 * Retire when:      the create-game infra contract changes — e.g. table renamed,
 *                   PutItem scope widened by design (s005 adds Connections RW +
 *                   ManageConnections; revisit T3 then), cache policy changed, or
 *                   reserved-concurrency cap removed by an explicit decision.
 * Surface:          live AWS (read-only CLI, allowlisted patterns) + PROD_URL.
 *                   AWS_PROFILE from env (default dev-int), region eu-west-2.
 * Skips gracefully: when AWS credentials are absent/expired (sts get-caller-identity
 *                   fails), every AWS assertion test.skips with a clear message so
 *                   the validation suite remains runnable API-contract-only.
 * Replaces:         the tester's ad-hoc `aws dynamodb get-item`, `aws iam
 *                   get-role-policy`, `aws lambda get-function-concurrency`, and
 *                   `aws cloudfront get-distribution-config` CLI spot-checks from
 *                   slice 004 step 16.
 * =============================================================================
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const PROFILE = process.env.AWS_PROFILE ?? 'dev-int';
const REGION = 'eu-west-2';

const GAMES_TABLE = 'oxo-games';
const GAMES_TABLE_ARN = 'arn:aws:dynamodb:eu-west-2:817047731316:table/oxo-games';
const FUNCTION = 'oxo-game-fn';
const DISTRIBUTION = 'E519HYABC57ZX';
const CACHING_DISABLED_POLICY_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

/** Run an aws CLI call read-only, return parsed JSON. Throws on non-zero exit. */
function aws(args: string[]): unknown {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
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
  `API-contract spec still runs; policy assertions skipped.`;

test.describe('Slice 004 — AWS infra & security policy', () => {
  test.skip(!AWS_OK, SKIP_MSG);

  test('T1 + S1 (persisted) — created game item: status="waiting", server-generated, ttl ~86400s ahead', async () => {
    // Create a real game against prod, then read it back from DynamoDB.
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    let body: { gameId: string; code: string };
    const requestedAt = Date.now() / 1000;
    try {
      const res = await ctx.post('/api/games', {
        // Plant values (S1) — the stored item must not contain any of these.
        data: { gameId: 'planted', code: 'HACKED', status: 'finished', ttl: 1 },
      });
      expect(res.status()).toBe(201);
      body = await res.json();
    } finally {
      await ctx.dispose();
    }

    const item = (
      aws([
        'dynamodb',
        'get-item',
        '--table-name',
        GAMES_TABLE,
        '--key',
        JSON.stringify({ gameId: { S: body.gameId } }),
        '--consistent-read',
      ]) as { Item?: Record<string, { S?: string; N?: string }> }
    ).Item;

    expect(item, `no item found for gameId ${body.gameId}`).toBeTruthy();
    const it = item!;

    // Server-generated, not the planted values (S1, stored half).
    expect(it.gameId?.S, 'stored gameId must equal the server-issued id').toBe(body.gameId);
    expect(it.gameId?.S, 'stored gameId must not be the planted value').not.toBe('planted');
    expect(it.code?.S, 'stored code must not be the planted value').not.toBe('HACKED');
    expect(it.code?.S ?? '', 'stored code must be unambiguous 6-char').toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    // T1: status="waiting".
    expect(it.status?.S, 'stored status must be "waiting", not the planted "finished"').toBe('waiting');

    // T1: ttl ~86400s (24h) ahead of the request time, not the planted ttl=1.
    const ttl = Number(it.ttl?.N);
    expect(Number.isFinite(ttl), 'ttl must be a number').toBe(true);
    const delta = ttl - requestedAt;
    expect(
      Math.abs(delta - 86400),
      `ttl delta ${delta.toFixed(0)}s must be within 300s of 86400s (24h)`,
    ).toBeLessThan(300);
  });

  test('T5 — oxo-game-fn reserved concurrency is set and > 0', async () => {
    const conc = aws(['lambda', 'get-function-concurrency', '--function-name', FUNCTION]) as {
      ReservedConcurrentExecutions?: number;
    };
    expect(
      conc.ReservedConcurrentExecutions,
      'ReservedConcurrentExecutions must be a finite cap > 0 (not unreserved/default)',
    ).toBeGreaterThan(0);
  });

  test('T3 — execution role grants dynamodb:PutItem on Games+Codes ARNs; no wildcard; no other actions (s005-h3 amended)', async () => {
    // NOTE (s005-h3 amendment): the original T3 asserted PutItem on oxo-games ONLY.
    // s005-h3 (delta 009, OI-3) introduced the Codes reservation table and added a
    // scoped PutItem grant on the Codes table ARN to the same role. T3 is amended to
    // assert: PutItem on Games+Codes ARNs (and their CDK-generated index/* CDK artifact);
    // no other DynamoDB action; no wildcard resource. This is the correct post-s005-h3
    // contract (validated and evidence in slice005-h3-code-uniqueness.spec.ts AC-5).
    // Discover the role at runtime (CDK appends a generated suffix; never hardcode).
    const roleArn = (
      aws(['lambda', 'get-function', '--function-name', FUNCTION]) as {
        Configuration: { Role: string };
      }
    ).Configuration.Role;
    const roleName = roleArn.split('/').pop()!;

    const policyNames = (
      aws(['iam', 'list-role-policies', '--role-name', roleName]) as { PolicyNames: string[] }
    ).PolicyNames;
    expect(policyNames.length, 'role must have at least one inline policy').toBeGreaterThan(0);

    // Gather every statement across all inline policies.
    type Stmt = { Effect: string; Action: string | string[]; Resource: string | string[] };
    const statements: Stmt[] = [];
    for (const pn of policyNames) {
      const doc = (
        aws(['iam', 'get-role-policy', '--role-name', roleName, '--policy-name', pn]) as {
          PolicyDocument: { Statement: Stmt | Stmt[] };
        }
      ).PolicyDocument;
      const s = doc.Statement;
      statements.push(...(Array.isArray(s) ? s : [s]));
    }

    const asArr = (x: string | string[]) => (Array.isArray(x) ? x : [x]);

    // PutItem on the Games ARN must be present.
    // NOTE: CDK's table.grant() automatically includes the GSI index ARN in the resource
    // list (e.g. oxo-games/index/* for the code-index GSI). This is a CDK artifact —
    // DynamoDB ignores PutItem on GSI ARNs (PutItem only applies to base tables).
    // s005-h3: PutItem is ALSO granted on the Codes table ARN (AC-5 pin). The allowed
    // resource set is: oxo-games ARN, oxo-games/index/* (CDK artifact), oxo-codes ARN.
    const GAMES_INDEX_ARN_PATTERN = `${GAMES_TABLE_ARN}/index/`;
    const CODES_TABLE_ARN = 'arn:aws:dynamodb:eu-west-2:817047731316:table/oxo-codes';

    const putStmts = statements.filter(
      (s) => s.Effect === 'Allow' && asArr(s.Action).includes('dynamodb:PutItem'),
    );
    expect(putStmts.length, 'role must allow dynamodb:PutItem').toBeGreaterThan(0);

    // Collect all PutItem resources; must ALL be in the allowed set.
    const allPutResources: string[] = [];
    for (const s of putStmts) {
      for (const r of asArr(s.Resource)) {
        allPutResources.push(r);
      }
    }

    // Must cover Games table.
    expect(
      allPutResources.some((r) => r === GAMES_TABLE_ARN),
      `PutItem must cover Games table ARN (${GAMES_TABLE_ARN})`,
    ).toBe(true);
    // Must cover Codes table (s005-h3 AC-5 pin).
    expect(
      allPutResources.some((r) => r === CODES_TABLE_ARN),
      `PutItem must cover Codes table ARN (${CODES_TABLE_ARN}) — s005-h3 AC-5 pin`,
    ).toBe(true);
    // Each resource must be in the permitted set (Games ARN, Games index/*, Codes ARN).
    for (const r of allPutResources) {
      expect(
        r === GAMES_TABLE_ARN ||
        r.startsWith(GAMES_INDEX_ARN_PATTERN) ||
        r === CODES_TABLE_ARN,
        `PutItem resource "${r}" must be Games ARN, Games index/*, or Codes ARN (s005-h3 AC-5)`,
      ).toBe(true);
    }

    // No statement may grant a wildcard dynamodb action or wildcard resource on dynamo.
    // Only PutItem is allowed; no other dynamodb action on game-fn role.
    for (const s of statements) {
      const actions = asArr(s.Action);
      const resources = asArr(s.Resource);
      const touchesDynamo = actions.some((a) => a.startsWith('dynamodb:')) ||
        resources.some((r) => r.includes(':dynamodb:'));
      if (!touchesDynamo) continue;
      for (const a of actions) {
        expect(a, `no wildcard dynamodb action allowed (found "${a}")`).not.toBe('dynamodb:*');
        expect(a, `no full wildcard action allowed (found "${a}")`).not.toBe('*');
        // Only PutItem is allowed on game-fn (it creates, never reads/updates/deletes).
        expect(a, `game-fn must only have dynamodb:PutItem (found "${a}")`).toBe('dynamodb:PutItem');
      }
      for (const r of resources) {
        expect(r, 'no full "*" resource allowed on a dynamodb-touching statement').not.toBe('*');
        if (r.includes(':dynamodb:')) {
          expect(r, `no wildcard dynamodb resource allowed (found "${r}")`).not.toContain('table/*');
        }
      }
    }

    console.log(`T3 PASS (s005-h3 amended): PutItem on Games+Codes ARNs; no wildcard; only PutItem.`);
    console.log(`  All PutItem resources: ${JSON.stringify(allPutResources)}`);
  });

  test('T2 — /api/* CloudFront behaviour uses managed CachingDisabled policy', async () => {
    const cfg = aws(['cloudfront', 'get-distribution-config', '--id', DISTRIBUTION]) as {
      DistributionConfig: {
        CacheBehaviors: { Items?: { PathPattern: string; CachePolicyId?: string }[] };
      };
    };
    const items = cfg.DistributionConfig.CacheBehaviors.Items ?? [];
    const apiBehaviour = items.find((b) => b.PathPattern === '/api/*');
    expect(apiBehaviour, 'a /api/* cache behaviour must exist').toBeTruthy();
    expect(
      apiBehaviour!.CachePolicyId,
      'the /api/* behaviour must use the managed CachingDisabled policy id',
    ).toBe(CACHING_DISABLED_POLICY_ID);
  });
});
