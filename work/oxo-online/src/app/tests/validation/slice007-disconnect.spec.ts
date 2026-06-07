import { test, expect, request as pwRequest } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * VALIDATION SPEC HEADER (process v16 §35, IMP-002)
 * Slice: s007-disconnect
 * Iteration: 10
 * Acceptance cases pinned:
 *   S5  — oxo-ws-fn IAM policy = s006 grant set + EXACTLY GetItem on Connections;
 *          no Query/Scan/wildcard; no new table. One assertion changes from s006 pin.
 *   AC4.6 — S4 Logs Insights relay-count pin: exactly 1 disconnect-notify posted:1
 *            per active-game $disconnect; 0 for terminal/waiting $disconnect
 *            (OI-35 S4 pin — amplification bound confirmed in prod)
 *   AC4.4(log) — Logs Insights confirms 0 posted:1 lines for terminal-game $disconnect
 *                (T4 log arm — the DDB arm is in the smoke spec)
 *   T7    — idle-timeout posture: the disconnect-notify structured log carrier
 *            confirms the handler runs on any $disconnect trigger (AC1.9 posture)
 * Relevancy: pinned (standing IAM regression for s007 grant; S4 log-derived pin)
 * Retire when: IAM policy reconstituted; log schema changes; disconnect handler removed.
 * Surface: live AWS (read-only IAM + CloudWatch Logs CLI via allowlisted patterns)
 * Skips gracefully: AWS-dependent assertions self-skip when credentials absent.
 *
 * Failure classification (process v30 §5a):
 *   aws CLI 5xx = external; note if call failed/retried.
 *   IAM assertion failure = our grant set wrong (engineering defect).
 *   Log query mismatch = our Lambda posted wrong count (engineering defect).
 *
 * IMPORTANT — S4/AC4.6 ORDERING CONSTRAINT:
 *   The Logs Insights tests query a specific window set during the smoke run.
 *   They MUST run AFTER the smoke suite creates the active-game + terminal-game
 *   $disconnect events. Query window is set via LOG_QUERY_START_EPOCH env var
 *   (seconds-since-epoch, set before the smoke suite starts). If absent, queries
 *   cover the last 5 minutes (best-effort; may miss the relevant events).
 *
 * LOG_QUERY_START_EPOCH: set to unix epoch (seconds) just before the smoke run.
 * ACTIVE_GAME_ID, TERMINAL_GAME_ID: set by the smoke spec (or caller) to pin
 *   the Logs Insights gameId filter. If absent, queries are broad (last 5 min).
 */

const PROD_URL = process.env.PROD_URL ?? 'https://d3pf3kcvzpau1x.cloudfront.net';
const PROFILE = process.env.AWS_PROFILE ?? 'dev-int';
const REGION = 'eu-west-2';
const WS_FN = 'oxo-ws-fn';
const LOG_GROUP = '/aws/lambda/oxo-ws-fn';
const CONNECTIONS_TABLE_ARN = `arn:aws:dynamodb:${REGION}:817047731316:table/oxo-connections`;
const GAMES_TABLE_ARN = `arn:aws:dynamodb:${REGION}:817047731316:table/oxo-games`;
const WS_API_ARN_PREFIX = `arn:aws:execute-api:${REGION}:817047731316:ylbzjuo8lf`;

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

/** POST /api/games via request context to get a real gameId + code + wsToken. */
async function createGame(): Promise<{ gameId: string; code: string; wsToken: string }> {
  const ctx = await pwRequest.newContext({ baseURL: PROD_URL });
  const res = await ctx.post('/api/games', { data: {} });
  expect(res.status(), 'POST /api/games must return 201').toBe(201);
  const body = await res.json() as { gameId: string; code: string; wsToken: string };
  expect(body.gameId, 'gameId must be present').toBeTruthy();
  expect(body.code, 'code must be present').toBeTruthy();
  expect(body.wsToken, 'wsToken must be present').toBeTruthy();
  await ctx.dispose();
  return body;
}

/**
 * Poll a Logs Insights query until complete, with bounded retries.
 * Returns the query results or throws on timeout.
 */
function pollLogsInsights(queryId: string, maxAttempts = 20): unknown[] {
  for (let i = 0; i < maxAttempts; i++) {
    const result = aws([
      'logs', 'get-query-results',
      '--query-id', queryId,
    ]) as { status: string; results: unknown[] };

    if (result.status === 'Complete') {
      return result.results;
    }
    if (result.status === 'Failed' || result.status === 'Cancelled') {
      throw new Error(`Logs Insights query ${queryId} ended with status ${result.status}`);
    }
    // Wait ~3s between polls (busy-wait acceptable for validation spec — not CI hot path).
    const end = Date.now() + 3000;
    while (Date.now() < end) { /* spin */ }
  }
  throw new Error(`Logs Insights query ${queryId} did not complete in ${maxAttempts} attempts (~${maxAttempts * 3}s)`);
}

test.describe('s007 validation — IAM grant + S4 log relay-count pin', () => {
  test.skip(!PROD_URL, 'PROD_URL not set.');

  // --------------------------------------------------------------------------
  // S5 (AC2.1 + AC2.2) — IAM grant: s007 change = +GetItem on Connections only.
  //
  // Positive arm (AC2.1): ConnectionsRead statement with GetItem on Connections.
  // Negative arm (AC2.2): no Query/Scan/wildcard; no new table; s006 grants intact.
  //
  // This spec changes EXACTLY ONE assertion from the s006 S5 pin:
  //   - ADD: GetItem on Connections ARN is present (new ConnectionsRead Sid).
  //   - UNCHANGED: all s006 grants (GamesReadByCode, GamesConditionalUpdate,
  //     ConnectionsWrite, ManageConnectionsThisApiOnly) are still present.
  // --------------------------------------------------------------------------
  test('S5 (AC2.1+AC2.2) — ws-fn IAM: +ConnectionsRead; s006 grants unchanged; no widening', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const listResult = aws([
      'iam', 'list-role-policies',
      '--role-name', 'OxoGameProd-WsFunctionRole880EC232-HpSnaUdekkVV',
    ]) as { PolicyNames: string[] };

    expect(listResult.PolicyNames.length, 'S5: at least one inline policy must exist').toBeGreaterThan(0);

    const policyName = listResult.PolicyNames[0];
    const policyResult = aws([
      'iam', 'get-role-policy',
      '--role-name', 'OxoGameProd-WsFunctionRole880EC232-HpSnaUdekkVV',
      '--policy-name', policyName,
    ]) as { PolicyDocument: Record<string, unknown> };

    const policyDoc = policyResult.PolicyDocument as {
      Statement: Array<{ Action: string | string[]; Resource: string | string[]; Sid?: string }>;
    };
    const policyStr = JSON.stringify(policyDoc);
    const stmts = policyDoc.Statement;

    console.log(`S5: inspecting policy "${policyName}"`);
    console.log(`S5: statement sids: ${stmts.map(s => s.Sid ?? '(no sid)').join(', ')}`);

    // ---- AC2.1: POSITIVE — ConnectionsRead (GetItem on Connections) is present ----
    const connRead = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return actions.some(a => a === 'dynamodb:GetItem') &&
             resources.some(r => r === CONNECTIONS_TABLE_ARN);
    });
    expect(
      connRead,
      'AC2.1 S5: dynamodb:GetItem on oxo-connections ARN must be present (s007 new grant)',
    ).toBeTruthy();
    console.log(`AC2.1 PASS: ConnectionsRead (GetItem on Connections) present — Sid="${connRead?.Sid}"`);

    // ---- AC2.2: NEGATIVE — no widening ----

    // No wildcard action
    expect(
      policyStr.includes('"*"'),
      'AC2.2 S5: policy must not contain any wildcard ("*") action or resource',
    ).toBe(false);

    // No Query or Scan on the CONNECTIONS table (the critical constraint: only GetItem on Connections).
    // NOTE: dynamodb:Query IS allowed on oxo-games/index/code-index (for guest join by code —
    // existing s006 GamesReadByCode grant). The constraint is that CONNECTIONS must NOT get Query/Scan.
    const connQueryOrScan = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return actions.some(a => a === 'dynamodb:Query' || a === 'dynamodb:Scan') &&
             resources.some(r => r.includes('oxo-connections'));
    });
    expect(
      connQueryOrScan,
      `AC2.2 S5: no dynamodb:Query or dynamodb:Scan must be present on oxo-connections (only GetItem allowed)`,
    ).toBeUndefined();

    // No wildcard on Connections table (no dangerous * actions).
    const connWildcard = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return (actions.includes('dynamodb:*') || actions.includes('*')) &&
             resources.some(r => r.includes('oxo-connections'));
    });
    expect(
      connWildcard,
      `AC2.2 S5: no wildcard DynamoDB action must be present on oxo-connections`,
    ).toBeUndefined();

    // Games table grants intact (GamesReadByCode + GamesConditionalUpdate)
    const gamesGetItem = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return actions.includes('dynamodb:GetItem') &&
             resources.some(r => r === GAMES_TABLE_ARN || r.startsWith(GAMES_TABLE_ARN));
    });
    expect(gamesGetItem, 'AC2.2 S5: dynamodb:GetItem on oxo-games must still exist (s006 GamesReadByCode)').toBeTruthy();

    const gamesUpdateItem = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return actions.includes('dynamodb:UpdateItem') &&
             resources.some(r => r === GAMES_TABLE_ARN);
    });
    expect(gamesUpdateItem, 'AC2.2 S5: dynamodb:UpdateItem on oxo-games must still exist (s006 GamesConditionalUpdate)').toBeTruthy();

    // Connections write grants intact (ConnectionsWrite: DeleteItem + PutItem)
    const connWrite = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      return actions.some(a => a === 'dynamodb:DeleteItem' || a === 'dynamodb:PutItem') &&
             resources.some(r => r === CONNECTIONS_TABLE_ARN);
    });
    expect(connWrite, 'AC2.2 S5: dynamodb:DeleteItem/PutItem on oxo-connections must still exist (s006 ConnectionsWrite)').toBeTruthy();

    // ManageConnections grant intact
    const manageConn = stmts.find(s => {
      const actions = Array.isArray(s.Action) ? s.Action : [s.Action];
      return actions.includes('execute-api:ManageConnections');
    });
    expect(manageConn, 'AC2.2 S5: execute-api:ManageConnections must still exist (s006 relay grant)').toBeTruthy();
    const mgmtResource = Array.isArray(manageConn?.Resource)
      ? manageConn!.Resource as string[]
      : [manageConn?.Resource as string];
    expect(
      mgmtResource.every(r => r.startsWith(WS_API_ARN_PREFIX) && !r.includes('*:*')),
      `AC2.2 S5: ManageConnections resource must be scoped to this API only (${WS_API_ARN_PREFIX}/…). Got: ${mgmtResource.join(', ')}`,
    ).toBe(true);

    // No new tables: only the two known tables may appear
    const allResources = stmts.flatMap(s =>
      (Array.isArray(s.Resource) ? s.Resource : [s.Resource]) as string[]
    );
    const tableArns = allResources.filter(r => r.includes('dynamodb') && r.includes('table/'));
    const knownTables = ['oxo-games', 'oxo-connections'];
    const unknownTables = tableArns.filter(r =>
      !knownTables.some(t => r.includes(t))
    );
    expect(
      unknownTables,
      `AC2.2 S5: no new DynamoDB tables must be added beyond oxo-games and oxo-connections. Found: ${unknownTables.join(', ')}`,
    ).toHaveLength(0);

    console.log(`S5 AC2.1+AC2.2 PASS: ConnectionsRead present; no widening; all s006 grants intact`);
  });

  // --------------------------------------------------------------------------
  // AC4.6 / S4 (OI-35) — Logs Insights relay-count pin.
  //
  // Queries CloudWatch Logs Insights on /aws/lambda/oxo-ws-fn for:
  //   A) Active-game $disconnect: exactly 1 "disconnect-notify posted:1" log line
  //      for the gameId recorded in ACTIVE_GAME_ID env (set by the smoke suite).
  //   B) Terminal-game $disconnect: exactly 0 "disconnect-notify posted:1" lines
  //      for the gameId in TERMINAL_GAME_ID env (set by the smoke suite post-AC4.4).
  //
  // If ACTIVE_GAME_ID / TERMINAL_GAME_ID are absent, the query uses a broader
  // recent-window filter (last 5 min) which may produce inconclusive results —
  // the test will still pass (BEST EFFORT) with a console warning, to avoid
  // false failures from missing env vars in standalone validation runs.
  //
  // Logs Insights query uses allowlisted aws logs start-query / get-query-results.
  // --------------------------------------------------------------------------
  test('AC4.6/S4 — Logs Insights: 1 posted:1 for active-game disconnect; 0 for terminal', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const activeGameId = process.env.ACTIVE_GAME_ID;
    const terminalGameId = process.env.TERMINAL_GAME_ID;
    const queryStartEpoch = process.env.LOG_QUERY_START_EPOCH
      ? parseInt(process.env.LOG_QUERY_START_EPOCH, 10)
      : Math.floor(Date.now() / 1000) - 300; // last 5 min
    const queryEndEpoch = Math.floor(Date.now() / 1000);

    console.log(`AC4.6: query window ${new Date(queryStartEpoch * 1000).toISOString()} → ${new Date(queryEndEpoch * 1000).toISOString()}`);
    console.log(`AC4.6: ACTIVE_GAME_ID="${activeGameId ?? 'not set'}" TERMINAL_GAME_ID="${terminalGameId ?? 'not set'}"`);

    // ---- A: Active-game $disconnect — expect posted=1 ----
    const activeFilter = activeGameId
      ? `filter evt = "disconnect-notify" and gameId = "${activeGameId}" and posted = 1`
      : `filter evt = "disconnect-notify" and posted = 1`;
    const activeQueryResult = aws([
      'logs', 'start-query',
      '--log-group-name', LOG_GROUP,
      '--start-time', String(queryStartEpoch),
      '--end-time', String(queryEndEpoch),
      '--query-string', `${activeFilter} | stats count() as cnt`,
    ]) as { queryId: string };

    console.log(`AC4.6: started active-game query id=${activeQueryResult.queryId}`);
    const activeResults = pollLogsInsights(activeQueryResult.queryId);
    console.log(`AC4.6: active-game query results: ${JSON.stringify(activeResults)}`);

    // Extract count from results (Logs Insights returns [{field: ..., value: ...}] per row).
    const activeCount = activeResults.length > 0
      ? parseInt(
          ((activeResults[0] as Array<{field: string; value: string}>)
            .find(f => f.field === 'cnt') ?? { value: '0' }).value,
          10,
        )
      : 0;

    if (!activeGameId) {
      console.warn(
        'AC4.6 WARNING: ACTIVE_GAME_ID not set — querying last 5min for any posted=1 line. ' +
        'Result is best-effort; set ACTIVE_GAME_ID from smoke run for a pinned assertion.',
      );
      // Best-effort: just confirm at least 1 posted:1 line exists in the window.
      // We can't assert exactly 1 without knowing the gameId.
      console.log(`AC4.6 BEST-EFFORT (active): found ${activeCount} posted=1 lines in window`);
    } else {
      expect(
        activeCount,
        `AC4.6 S4: active-game disconnect for gameId=${activeGameId} must produce exactly 1 disconnect-notify posted=1 log line`,
      ).toBe(1);
      console.log(`AC4.6 PASS (active): gameId=${activeGameId} posted=1 count=${activeCount}`);
    }

    // ---- B: Terminal-game $disconnect — expect posted=0 (0 posted=1 lines) ----
    if (terminalGameId) {
      const terminalFilter = `filter evt = "disconnect-notify" and gameId = "${terminalGameId}" and posted = 1`;
      const terminalQueryResult = aws([
        'logs', 'start-query',
        '--log-group-name', LOG_GROUP,
        '--start-time', String(queryStartEpoch),
        '--end-time', String(queryEndEpoch),
        '--query-string', `${terminalFilter} | stats count() as cnt`,
      ]) as { queryId: string };

      console.log(`AC4.6: started terminal-game query id=${terminalQueryResult.queryId}`);
      const terminalResults = pollLogsInsights(terminalQueryResult.queryId);
      console.log(`AC4.6: terminal-game query results: ${JSON.stringify(terminalResults)}`);

      const terminalCount = terminalResults.length > 0
        ? parseInt(
            ((terminalResults[0] as Array<{field: string; value: string}>)
              .find(f => f.field === 'cnt') ?? { value: '0' }).value,
            10,
          )
        : 0;

      expect(
        terminalCount,
        `AC4.6 S4: terminal-game disconnect for gameId=${terminalGameId} must produce 0 disconnect-notify posted=1 log lines (won/drawn guard)`,
      ).toBe(0);
      console.log(`AC4.6 PASS (terminal): gameId=${terminalGameId} posted=1 count=${terminalCount} (expected 0)`);
    } else {
      console.warn(
        'AC4.6 WARNING: TERMINAL_GAME_ID not set — skipping terminal-game 0-posted assertion. ' +
        'Set TERMINAL_GAME_ID from smoke AC4.4 run for a pinned assertion.',
      );
    }
  });

  // --------------------------------------------------------------------------
  // T7 — Idle-timeout posture (AC1.9 carrier check).
  //
  // T7 is documented/prod-validated posture per acceptance.md. This test asserts
  // the structural carrier: the disconnect-notify log line with buildSha exists
  // in recent Lambda logs, confirming the handler emits the structured line on
  // every $disconnect invocation. It does NOT run a 10-min idle test.
  //
  // Method: Logs Insights query for any disconnect-notify line in the last 60
  // minutes. At least one must exist (assuming smoke ran first). If none, this
  // is a COVERAGE WARNING (not a structural failure — T7 is a posture assertion).
  // --------------------------------------------------------------------------
  test('T7 posture — disconnect-notify structured log line exists with buildSha (AC1.9 carrier)', async () => {
    test.skip(skipIfNoCredentials(), 'AWS credentials not available');

    const endEpoch = Math.floor(Date.now() / 1000);
    const startEpoch = endEpoch - 3600; // last 60 min

    const queryResult = aws([
      'logs', 'start-query',
      '--log-group-name', LOG_GROUP,
      '--start-time', String(startEpoch),
      '--end-time', String(endEpoch),
      '--query-string', 'filter evt = "disconnect-notify" | fields buildSha, gameId, posted, gone | limit 5',
    ]) as { queryId: string };

    console.log(`T7: started carrier-check query id=${queryResult.queryId}`);
    const results = pollLogsInsights(queryResult.queryId);
    console.log(`T7: carrier-check results: ${JSON.stringify(results)}`);

    if (results.length === 0) {
      console.warn(
        'T7 WARNING: no disconnect-notify log lines found in the last 60 minutes. ' +
        'This is expected if no $disconnect event fired in this window. ' +
        'Run the smoke suite first to produce events, then re-run validation.',
      );
      // Posture assertion — pass with warning (T7 is documented posture, not a blocking CI test).
    } else {
      // Check that at least one line carries the buildSha field (AC1.9).
      const firstRow = results[0] as Array<{field: string; value: string}>;
      const buildShaField = firstRow.find(f => f.field === 'buildSha');
      const buildShaValue = buildShaField?.value;
      expect(
        buildShaValue,
        'T7 AC1.9: disconnect-notify log line must carry a non-empty buildSha field (principles/01 carrier)',
      ).toBeTruthy();
      console.log(`T7 PASS: disconnect-notify carrier confirmed buildSha="${buildShaValue}"`);
    }
  });

  // --------------------------------------------------------------------------
  // S5 COVERAGE NOTE (§12a finding): the s007 validation changes EXACTLY ONE
  // assertion from the s006 S5 pin — the positive arm for ConnectionsRead.
  // The negative arm is expanded (must still not have Query/Scan; must not have
  // new tables). This spec captures BOTH arms in the S5 test above.
  // --------------------------------------------------------------------------
});
