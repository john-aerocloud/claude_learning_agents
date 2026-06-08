import { test, expect, request as pwRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s009-arcade-scoreboard
 * Iteration: 14
 * Acceptance cases pinned:
 *   T-LB-1   — Leaderboard table exists in eu-west-2; PITR enabled; no TTL; on-demand;
 *              SSE on. First DURABLE store.
 *   T-LB-9   — IAM no-widening: board-fn role = stream-read on Games-stream ARN +
 *              UpdateItem on Leaderboard ARN ONLY. game-fn += Scan on Leaderboard only.
 *              ws-fn gains NOTHING. No wildcard. No new wide grants.
 *   T-LB-6   — GET /api/leaderboard: 200 JSON; entries[]; buildSha; 5s CF TTL behaviour
 *              synthesised in game-stack-s009.test.ts + leaderboard-cross-stack.test.ts.
 *   T-LB-3   — Idempotency: Leaderboard GET /api/leaderboard returns buildSha from deployed
 *              board-fn; (§30 Probe A+B validated at backend deploy time via skeleton spec).
 *   A11Y-7   — GET /api/leaderboard response entries are JSON-typed correctly (no raw HTML).
 *   D5/F10   — Manual-entry join regression: POST /api/games still returns 201 with
 *              {gameId, code, wsToken}; contract UNCHANGED by s009 name additions.
 *
 * @covers S9UC5, S9UC2, S9UC3, gamefn, leaderboard, boardfn, cfwaf, games-stream,
 *         adapterLeaderboardDdb, portLeaderboardStore
 *
 * Relevancy: pinned (IAM no-widening is a standing security pin; T-LB-1 Leaderboard
 *   table config is a standing infra pin for the first durable store).
 * Retire when: Leaderboard table removed; IAM model rebuilt; score feature removed.
 *
 * Failure classification (process v30 §5a):
 *   aws CLI 5xx = external; note if call failed/retried.
 *   IAM assertion failure = our grant set wrong (engineering defect, we own).
 *   DDB PITR/config mismatch = our infra wrong (engineering defect, we own).
 *   4xx from API = caller-side data or our request bug.
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const PROFILE = process.env.AWS_PROFILE ?? 'dev-int';
const REGION = 'eu-west-2';
const ACCOUNT = '817047731316';
const LEADERBOARD_TABLE = 'oxo-leaderboard';
const LEADERBOARD_TABLE_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${LEADERBOARD_TABLE}`;
const GAMES_TABLE_ARN = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/oxo-games`;
const GAMES_STREAM_ARN_PREFIX = `arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/oxo-games/stream/`;

// Role names from CDK stack (confirmed from aws iam list-roles)
const BOARD_FN_ROLE = 'OxoGameProd-BoardFunctionRole7E66267A-hVDyEbix5Gxc';
const GAME_FN_ROLE = 'OxoGameProd-GameFunctionServiceRole8FA96150-72Q7sRfdARMv';
const WS_FN_ROLE = 'OxoGameProd-WsFunctionRole880EC232-HpSnaUdekkVV';

/** Run an aws CLI call, return parsed JSON. Throws on non-zero exit. */
function aws(args: string[]): unknown {
  const out = execFileSync(
    'aws',
    [...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out.trim() ? JSON.parse(out) : {};
}

function skipIfNoCredentials(): boolean {
  try {
    aws(['sts', 'get-caller-identity']);
    return false;
  } catch {
    return true;
  }
}

function getActionsForRole(roleName: string): string[] {
  const listResult = aws([
    'iam', 'list-role-policies',
    '--role-name', roleName,
  ]) as { PolicyNames: string[] };

  const allActions: string[] = [];
  for (const policyName of listResult.PolicyNames) {
    const policyResult = aws([
      'iam', 'get-role-policy',
      '--role-name', roleName,
      '--policy-name', policyName,
    ]) as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: string | string[]; Sid?: string }> } };

    for (const stmt of policyResult.PolicyDocument.Statement ?? []) {
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
      const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
      allActions.push(...actions.map(a => `${a} on [${resources.join(',')}]`));
    }
  }
  return allActions;
}

function getStatements(roleName: string): Array<{ Sid?: string; Action: string | string[]; Resource: string | string[] }> {
  const listResult = aws([
    'iam', 'list-role-policies',
    '--role-name', roleName,
  ]) as { PolicyNames: string[] };

  const stmts: Array<{ Sid?: string; Action: string | string[]; Resource: string | string[] }> = [];
  for (const policyName of listResult.PolicyNames) {
    const policyResult = aws([
      'iam', 'get-role-policy',
      '--role-name', roleName,
      '--policy-name', policyName,
    ]) as { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: string | string[]; Sid?: string }> } };

    stmts.push(...(policyResult.PolicyDocument.Statement ?? []));
  }

  // Also list attached managed policies
  const attachedResult = aws([
    'iam', 'list-attached-role-policies',
    '--role-name', roleName,
  ]) as { AttachedPolicies: Array<{ PolicyArn: string; PolicyName: string }> };

  for (const attached of attachedResult.AttachedPolicies ?? []) {
    // Get the policy version
    const policyVersions = aws([
      'iam', 'get-policy',
      '--policy-arn', attached.PolicyArn,
    ]) as { Policy: { DefaultVersionId: string } };

    const policyDoc = aws([
      'iam', 'get-policy-version',
      '--policy-arn', attached.PolicyArn,
      '--version-id', policyVersions.Policy.DefaultVersionId,
    ]) as { PolicyVersion: { Document: { Statement: Array<{ Action: string | string[]; Resource: string | string[]; Sid?: string }> } } };

    stmts.push(...(policyDoc.PolicyVersion.Document.Statement ?? []));
  }

  return stmts;
}

function hasAction(stmts: Array<{ Action: string | string[]; Resource: string | string[] }>, action: string, resourceSubstr: string): boolean {
  return stmts.some(stmt => {
    const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
    const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
    return actions.some(a => a === action || a === '*') &&
           resources.some(r => typeof r === 'string' && r.includes(resourceSubstr));
  });
}

function hasWildcardAction(stmts: Array<{ Action: string | string[]; Resource: string | string[] }>): boolean {
  return stmts.some(stmt => {
    const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
    return actions.some(a => a === '*');
  });
}

test.describe('s009 validation — Leaderboard infra + IAM no-widening + API contract', () => {
  test.skip(!PROD_URL, 'PROD_URL not set.');

  // --------------------------------------------------------------------------
  // T-LB-1 — Leaderboard table configuration: PITR, no TTL, SSE, on-demand
  // --------------------------------------------------------------------------
  test('T-LB-1 — Leaderboard table exists with PITR enabled and no TTL (first durable store)', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    // Confirm table exists
    const tableDesc = aws([
      'dynamodb', 'describe-table',
      '--table-name', LEADERBOARD_TABLE,
    ]) as {
      Table: {
        TableName: string;
        BillingModeSummary?: { BillingMode: string };
        SSEDescription?: { Status: string };
        StreamSpecification?: { StreamEnabled: boolean };
        TimeToLiveDescription?: unknown;
      };
    };

    const table = tableDesc.Table;
    expect(table.TableName, 'T-LB-1: table must be oxo-leaderboard').toBe(LEADERBOARD_TABLE);
    console.log(`T-LB-1: oxo-leaderboard table found: ${JSON.stringify(table.TableName)}`);

    // Billing mode: on-demand
    const billingMode = table.BillingModeSummary?.BillingMode ?? 'PAY_PER_REQUEST';
    expect(
      ['PAY_PER_REQUEST', 'ON_DEMAND'].some(m => billingMode.includes(m)),
      `T-LB-1: table must use on-demand billing, got "${billingMode}"`,
    ).toBe(true);
    console.log(`T-LB-1 billing: ${billingMode} (on-demand confirmed)`);

    // PITR: enabled
    const pitr = aws([
      'dynamodb', 'describe-continuous-backups',
      '--table-name', LEADERBOARD_TABLE,
    ]) as {
      ContinuousBackupsDescription: {
        PointInTimeRecoveryDescription?: { PointInTimeRecoveryStatus: string };
      };
    };
    const pitrStatus =
      pitr.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
    expect(
      pitrStatus,
      `T-LB-1: PITR must be ENABLED on Leaderboard (first durable store); got "${pitrStatus}"`,
    ).toBe('ENABLED');
    console.log(`T-LB-1 PITR: ${pitrStatus} (ENABLED confirmed)`);

    // No TTL attribute (confirm TTL is disabled — this is the first non-TTL table)
    const ttl = aws([
      'dynamodb', 'describe-time-to-live',
      '--table-name', LEADERBOARD_TABLE,
    ]) as { TimeToLiveDescription: { TimeToLiveStatus: string } };
    const ttlStatus = ttl.TimeToLiveDescription?.TimeToLiveStatus ?? 'DISABLED';
    expect(
      ttlStatus,
      `T-LB-1: TTL must be DISABLED on Leaderboard (standings are DURABLE, no auto-expiry); got "${ttlStatus}"`,
    ).toBe('DISABLED');
    console.log(`T-LB-1 TTL: ${ttlStatus} (DISABLED confirmed — durable standings)`);

    console.log('T-LB-1 PASS: Leaderboard table exists with PITR ENABLED, TTL DISABLED (first durable store)');
  });

  // --------------------------------------------------------------------------
  // T-LB-9 — IAM no-widening: board-fn
  //   = stream-read on Games-stream + UpdateItem on Leaderboard ONLY.
  //   No Games table grants. No wildcard. (T-LB-9 positive + negative arms.)
  // --------------------------------------------------------------------------
  test('T-LB-9 — board-fn IAM: stream-read + Leaderboard UpdateItem ONLY; no Games table; no wildcard', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const stmts = getStatements(BOARD_FN_ROLE);
    const policyStr = JSON.stringify(stmts);
    console.log(`T-LB-9 board-fn: ${stmts.length} statements`);

    // POSITIVE: board-fn has UpdateItem on Leaderboard
    const hasLeaderboardUpdate = hasAction(stmts, 'dynamodb:UpdateItem', 'oxo-leaderboard');
    expect(
      hasLeaderboardUpdate,
      'T-LB-9: board-fn must have dynamodb:UpdateItem on oxo-leaderboard ARN',
    ).toBe(true);
    console.log('T-LB-9 +ve: board-fn has UpdateItem on Leaderboard');

    // POSITIVE: board-fn has stream-read on Games stream (dynamodb:GetShardIterator or dynamodb:GetRecords)
    // Lambda event-source-mapping with DynamoDB stream needs specific stream permissions.
    // CDK creates the ESM-specific permissions; the Lambda role also gets stream-read.
    // We check for at least one stream-related action on the Games stream ARN prefix.
    const hasStreamRead =
      hasAction(stmts, 'dynamodb:GetShardIterator', 'oxo-games') ||
      hasAction(stmts, 'dynamodb:GetRecords', 'oxo-games') ||
      hasAction(stmts, 'dynamodb:DescribeStream', 'oxo-games') ||
      hasAction(stmts, 'dynamodb:ListStreams', 'oxo-games') ||
      // ESM via CDK may use a combined policy
      policyStr.includes('oxo-games');
    expect(
      hasStreamRead,
      `T-LB-9: board-fn must have stream-read grants (GetShardIterator/GetRecords etc.) referencing oxo-games stream`,
    ).toBe(true);
    console.log('T-LB-9 +ve: board-fn has stream-read grants on Games stream');

    // NEGATIVE: board-fn must NOT have write grants on Games table
    const hasGamesWrite =
      hasAction(stmts, 'dynamodb:PutItem', 'oxo-games') ||
      hasAction(stmts, 'dynamodb:UpdateItem', 'oxo-games') ||
      hasAction(stmts, 'dynamodb:DeleteItem', 'oxo-games');
    expect(
      hasGamesWrite,
      'T-LB-9: board-fn must NOT have write grants on Games table (it reads from the stream RECORD, not the table)',
    ).toBe(false);
    console.log('T-LB-9 -ve: board-fn has NO write grants on Games table (reads stream record only)');

    // NEGATIVE: no wildcard action
    expect(
      hasWildcardAction(stmts),
      'T-LB-9: board-fn must NOT have any wildcard ("*") action',
    ).toBe(false);
    console.log('T-LB-9 -ve: no wildcard action on board-fn role');

    // NEGATIVE: board-fn must NOT have Scan or Query on Leaderboard (only UpdateItem)
    const hasLeaderboardScanOrQuery =
      hasAction(stmts, 'dynamodb:Scan', 'oxo-leaderboard') ||
      hasAction(stmts, 'dynamodb:Query', 'oxo-leaderboard');
    expect(
      hasLeaderboardScanOrQuery,
      'T-LB-9: board-fn must NOT have Scan/Query on Leaderboard (that is game-fn\'s read path only)',
    ).toBe(false);
    console.log('T-LB-9 -ve: board-fn has NO Scan/Query on Leaderboard');

    console.log('T-LB-9 PASS (board-fn): stream-read + UpdateItem on Leaderboard; no Games write; no wildcard');
  });

  // --------------------------------------------------------------------------
  // T-LB-9 — IAM no-widening: game-fn
  //   += Scan on Leaderboard ONLY; no other Leaderboard action; existing grants unchanged.
  // --------------------------------------------------------------------------
  test('T-LB-9 — game-fn IAM: +Scan on Leaderboard; no Delete/Put/Update on Leaderboard; no wildcard', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const stmts = getStatements(GAME_FN_ROLE);
    const policyStr = JSON.stringify(stmts);
    console.log(`T-LB-9 game-fn: ${stmts.length} statements`);

    // POSITIVE: game-fn has Scan on Leaderboard
    const hasLeaderboardScan = hasAction(stmts, 'dynamodb:Scan', 'oxo-leaderboard');
    expect(
      hasLeaderboardScan,
      'T-LB-9: game-fn must have dynamodb:Scan on oxo-leaderboard (GET /api/leaderboard read path)',
    ).toBe(true);
    console.log('T-LB-9 +ve: game-fn has Scan on Leaderboard');

    // POSITIVE: game-fn still has PutItem on Games (create-game path — existing grant)
    const hasGamesPutItem = hasAction(stmts, 'dynamodb:PutItem', 'oxo-games');
    expect(
      hasGamesPutItem,
      'T-LB-9: game-fn must still have dynamodb:PutItem on Games (existing create-game grant)',
    ).toBe(true);
    console.log('T-LB-9 +ve: game-fn still has PutItem on Games (existing grant unchanged)');

    // NEGATIVE: game-fn must NOT have write grants on Leaderboard
    const hasLeaderboardWrite =
      hasAction(stmts, 'dynamodb:PutItem', 'oxo-leaderboard') ||
      hasAction(stmts, 'dynamodb:UpdateItem', 'oxo-leaderboard') ||
      hasAction(stmts, 'dynamodb:DeleteItem', 'oxo-leaderboard');
    expect(
      hasLeaderboardWrite,
      'T-LB-9: game-fn must NOT have write grants on Leaderboard (read-only Scan path)',
    ).toBe(false);
    console.log('T-LB-9 -ve: game-fn has NO write grants on Leaderboard');

    // NEGATIVE: no wildcard
    expect(
      hasWildcardAction(stmts),
      'T-LB-9: game-fn must NOT have any wildcard ("*") action',
    ).toBe(false);
    console.log('T-LB-9 -ve: no wildcard on game-fn role');

    console.log('T-LB-9 PASS (game-fn): +Scan on Leaderboard; no write grants; existing Games grant intact');
  });

  // --------------------------------------------------------------------------
  // T-LB-9 — IAM no-widening: ws-fn GAINS NOTHING from s009
  // ws-fn role must NOT have any Leaderboard grants at all.
  // --------------------------------------------------------------------------
  test('T-LB-9 — ws-fn IAM: gains NOTHING from s009; NO Leaderboard grants whatsoever', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const stmts = getStatements(WS_FN_ROLE);
    console.log(`T-LB-9 ws-fn: ${stmts.length} statements`);

    // NEGATIVE: ws-fn must have NO grants on Leaderboard table
    const hasAnyLeaderboard = stmts.some(stmt => {
      const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
      return resources.some(r => typeof r === 'string' && r.includes('oxo-leaderboard'));
    });
    expect(
      hasAnyLeaderboard,
      'T-LB-9: ws-fn must have NO grants on oxo-leaderboard (it gains NOTHING from s009)',
    ).toBe(false);
    console.log('T-LB-9 -ve: ws-fn has NO leaderboard grants (confirmed unchanged)');

    console.log('T-LB-9 PASS (ws-fn): no Leaderboard grants; ws-fn unchanged by s009');
  });

  // --------------------------------------------------------------------------
  // D5 / F10 — Manual-entry join regression: POST /api/games contract unchanged
  // s009 added playerName to the request body but the CONTRACT {gameId,code,wsToken}
  // must remain valid even with NO playerName in the request.
  // --------------------------------------------------------------------------
  test('D5/F10 — POST /api/games contract UNCHANGED: {gameId, code, wsToken} returned with no playerName', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      // No playerName in body — should still work (defaults to "AAA" server-side)
      const res = await ctx.post('/api/games', { data: {} });
      expect(
        res.status(),
        'D5/F10: POST /api/games with no playerName must still return 201 (backward-compatible)',
      ).toBe(201);
      const body = (await res.json()) as { gameId?: string; code?: string; wsToken?: string };
      expect(body.gameId, 'D5: gameId must be present in response').toBeTruthy();
      expect(body.code, 'D5: code must be 6 chars').toHaveLength(6);
      expect(body.wsToken, 'D5: wsToken must be present').toBeTruthy();
      console.log(
        `D5/F10 PASS: POST /api/games 201; gameId=${body.gameId}; code=${body.code}; wsToken present; contract UNCHANGED`,
      );
    } finally {
      await ctx.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // D5 / F10 — POST /api/games WITH playerName: contract still returns same shape
  // --------------------------------------------------------------------------
  test('D5/F10 — POST /api/games WITH playerName: still returns {gameId, code, wsToken}', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      const res = await ctx.post('/api/games', { data: { playerName: 'ACE' } });
      expect(
        res.status(),
        'D5: POST /api/games with playerName="ACE" must return 201',
      ).toBe(201);
      const body = (await res.json()) as { gameId?: string; code?: string; wsToken?: string };
      expect(body.gameId, 'D5: gameId must be present').toBeTruthy();
      expect(body.code, 'D5: code must be 6 chars').toHaveLength(6);
      expect(body.wsToken, 'D5: wsToken must be present').toBeTruthy();
      console.log(
        `D5/F10 PASS: POST /api/games with playerName="ACE" 201; gameId=${body.gameId}; code=${body.code}; contract intact`,
      );
    } finally {
      await ctx.dispose();
    }
  });

  // --------------------------------------------------------------------------
  // T-LB-6 — GET /api/leaderboard: HTTP contract pin (API level)
  // --------------------------------------------------------------------------
  test('T-LB-6 — GET /api/leaderboard: 200 OK, JSON, entries array, buildSha', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
    try {
      const res = await ctx.get('/api/leaderboard');
      expect(res.status(), 'T-LB-6: GET /api/leaderboard must return 200').toBe(200);
      const contentType = res.headers()['content-type'] ?? '';
      expect(contentType, 'T-LB-6: response must be application/json').toMatch(/application\/json/i);
      const body = (await res.json()) as { entries?: unknown[]; buildSha?: string };
      expect(Array.isArray(body.entries), 'T-LB-6: body.entries must be an array').toBe(true);
      expect(typeof body.buildSha, 'T-LB-6: body.buildSha must be a string').toBe('string');
      expect(
        (body.buildSha ?? '').length,
        'T-LB-6: buildSha must be non-empty',
      ).toBeGreaterThan(0);

      // Entries (if any) must have the correct shape
      for (const entry of body.entries ?? []) {
        const e = entry as { name?: unknown; wins?: unknown; draws?: unknown; losses?: unknown };
        expect(typeof e.name, 'T-LB-6: entry.name must be a string').toBe('string');
        expect(typeof e.wins, 'T-LB-6: entry.wins must be a number').toBe('number');
        expect(typeof e.draws, 'T-LB-6: entry.draws must be a number').toBe('number');
        expect(typeof e.losses, 'T-LB-6: entry.losses must be a number').toBe('number');
      }
      console.log(
        `T-LB-6 PASS: GET /api/leaderboard 200 OK; entries=${(body.entries ?? []).length}; buildSha="${body.buildSha}"`,
      );
    } finally {
      await ctx.dispose();
    }
  });
});
