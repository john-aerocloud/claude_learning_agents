import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import type { LeaderboardStorePort } from '../board/ports';

/**
 * leaderboard-handler.ts (games) — the GET /api/leaderboard READ handler
 * (s009 UC3-backend, delta 010 §4). It is served by the EXISTING oxo-game-fn
 * (no new function/role/cold-start surface for one read). It depends only on the
 * domain-defined LeaderboardStorePort.topN — a Scan + in-memory sort behind the
 * port (the game-fn role gains EXACTLY dynamodb:Scan on the Leaderboard ARN; the
 * adapter issues Scan only, pinned at synth + in the adapter's command-type test).
 *
 * Response: { entries: [{name,wins,draws,losses}], buildSha } — buildSha in the
 * body is the read surface's build-identity carrier (principles/01). Top-20,
 * ordered wins desc / losses asc / name asc (the port's topN does the ordering).
 *
 * Failure posture (delta §4 / §failure-handling): a Scan failure after the SDK's
 * jittered backoff is a 5xx WE own — return a clean opaque 500 (no internal leak)
 * and log category:internal-service (a defect signal). The SPA renders an empty
 * board on failure (no aggressive retry loop — best-effort eventual).
 */

type LogFn = (line: Record<string, unknown>) => void;

interface LeaderboardHandlerDeps {
  store: LeaderboardStorePort;
  buildSha?: string;
  log?: LogFn;
}

const TOP_N = 20;

export function createLeaderboardHandler(deps: LeaderboardHandlerDeps) {
  const buildSha = deps.buildSha ?? process.env.BUILD_SHA ?? 'unknown';
  const log: LogFn = deps.log ?? ((line) => console.log(JSON.stringify(line)));

  return async function leaderboardHandler(
    _event: APIGatewayProxyEventV2,
  ): Promise<APIGatewayProxyResultV2> {
    try {
      const entries = await deps.store.topN(TOP_N);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entries, buildSha }),
      };
    } catch (err) {
      // A self-owned 5xx — defect signal, not terminal handling. Log the
      // category + buildSha so a support engineer can act; return an opaque 500.
      log({
        event: 'leaderboard_read_failed',
        buildSha,
        category: 'internal-service',
        op: 'Leaderboard.topN',
        error: (err as Error)?.name ?? 'unknown',
      });
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Could not load leaderboard' }),
      };
    }
  };
}
