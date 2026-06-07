import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import type { ExemptionPort } from '../ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * ddb-connect-exemption.ts — ADAPTER. Implements ExemptionPort over DynamoDB.
 *
 * s007a (DEFECT-S007-001). Reads the per-run, self-cleaning exemption item from
 * the SAME oxo-connect-attempts table under the reserved key
 * `sourceIp = EXEMPT#<ip>` (distinct from the counter key `<ip>` — they never
 * collide). The deploy/runner principal writes the item (PutItem) via
 * scripts/waf-runner-ip.js add and removes it (DeleteItem) via the if:always()
 * remove step, with a 1h TTL backstop.
 *
 * DEFECT-H2-003 — lazy-delete defence. DynamoDB TTL deletion is LAZY: an item
 * whose `ttl` has already passed can still be returned by GetItem for up to
 * ~48h. The exemption is therefore LIVE only if it exists AND `ttl > now`; this
 * adapter evaluates expiry itself and NEVER trusts the lazy delete. A stale item
 * (`ttl <= now`) or an item missing `ttl` is NOT an exemption.
 *
 * Fail-closed (§41). The exemption read fires ONLY on the already-over-budget
 * path, so it adds no happy-path latency; the SDK's default standard-retry mode
 * (exp backoff + jitter) handles transient errors within the Lambda timeout. On
 * any error after retries it returns FALSE so the RATE_LIMIT Deny STANDS — an
 * unavailable exemption store never weakens the control. The error is categorised
 * (5xx/timeout → EXTERNAL_DEPENDENCY; 4xx → INTERNAL) and logged with buildSha so
 * support can split availability-vs-our-defect; it is NOT rethrown (returning
 * not-exempt is the safe terminal behaviour for a gate).
 *
 * Code↔policy pin (CP-H2-E): this adapter issues ONLY GetItem against the
 * connect-attempts table — the read-only ConnectExemptionRead grant. No
 * Update/Put/Delete/Scan/Query (all ungranted on this statement).
 */

export interface DdbConnectExemptionDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  buildSha: string;
  log: LogFn;
}

const EXEMPT_PREFIX = 'EXEMPT#';

export class DdbConnectExemption implements ExemptionPort {
  constructor(private readonly deps: DdbConnectExemptionDeps) {}

  async isExempt(sourceIp: string, now: number): Promise<boolean> {
    try {
      const out = await this.deps.client.send(
        new GetCommand({
          TableName: this.deps.tableName,
          Key: { sourceIp: `${EXEMPT_PREFIX}${sourceIp}` },
        }),
      );
      const item = out.Item;
      if (!item) return false;
      const ttl = item.ttl;
      // Live iff a numeric ttl is still in the future. Never trust the lazy
      // delete: a stale (ttl <= now) or ttl-less item is NOT an exemption.
      return typeof ttl === 'number' && ttl > now;
    } catch (err) {
      const category = categoriseDdbError(err);
      this.deps.log({
        buildSha: this.deps.buildSha,
        category,
        op: 'ConnectAttempts.isExempt',
        sourceIp,
      });
      // Fail-closed: the RATE_LIMIT Deny stands.
      return false;
    }
  }
}
