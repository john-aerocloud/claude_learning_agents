import {
  DynamoDBDocumentClient,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ConnectCounterPort } from '../ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * ddb-connect-counter.ts — ADAPTER. Implements ConnectCounterPort over DynamoDB.
 * Returns the post-increment count for the source IP in the CURRENT per-IP
 * window.
 *
 * DEFECT-H2-003 — self-healing window. DynamoDB TTL deletion is LAZY (the item
 * can persist up to ~48h after `ttl` passes). The previous single
 * `ADD count + if_not_exists(ttl)` write therefore kept incrementing a STALE
 * count forever, so an IP that once crossed the threshold stayed blocked
 * indefinitely past its 5-minute window. We make the window self-heal:
 *
 *   1. UpdateItem `ADD count :one` (set first-write ttl), CONDITIONED on the
 *      window still being live: `attribute_not_exists(#ttl) OR #ttl > :now`.
 *      DynamoDB evaluates expiry server-side, so we never trust the lazy delete.
 *   2. If that condition fails (ConditionalCheckFailedException — the stored ttl
 *      has passed) the window has expired: PutItem OVERWRITES the item with
 *      `count = 1` and a fresh ttl, and we return 1 (this connect is the first
 *      of a brand-new window). The Put is itself guarded against the
 *      window-already-revived race (`attribute_not_exists OR #ttl <= :now`) so a
 *      concurrent live increment is never clobbered back to 1 — best-effort
 *      control (OR-H2-a); the steady state self-heals.
 *
 * Code↔policy pin (CP-H2-B): this adapter issues ONLY UpdateItem and PutItem
 * against the ConnectAttempts table — both are granted by the infra
 * `ConnectAttemptsWrite` statement (dynamodb:UpdateItem + dynamodb:PutItem). No
 * Get/Scan/Delete (ungranted). The conditional-check failure is normal control
 * flow, NOT a taxonomy failure — it is caught before categorisation and emits
 * no category line. Other failures: a 5xx/timeout from DynamoDB is
 * EXTERNAL_DEPENDENCY (availability); a non-conditional 4xx is INTERNAL (our bad
 * request). Both are logged with category + buildSha and rethrown.
 */

export interface DdbConnectCounterDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  ttlSeconds: number;
  now: () => number;
  buildSha: string;
  log: LogFn;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

export class DdbConnectCounter implements ConnectCounterPort {
  constructor(private readonly deps: DdbConnectCounterDeps) {}

  async increment(sourceIp: string): Promise<number> {
    const now = this.deps.now();
    const ttl = now + this.deps.ttlSeconds;

    // Step 1 — increment within the live window.
    try {
      const out = await this.deps.client.send(
        new UpdateCommand({
          TableName: this.deps.tableName,
          Key: { sourceIp },
          UpdateExpression: 'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
          ConditionExpression: 'attribute_not_exists(#ttl) OR #ttl > :now',
          ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': ttl, ':now': now },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return (out.Attributes?.count as number) ?? 0;
    } catch (err) {
      if (!isConditionalCheckFailed(err)) {
        const category = categoriseDdbError(err);
        this.deps.log({
          buildSha: this.deps.buildSha,
          category,
          op: 'ConnectAttempts.increment',
          sourceIp,
        });
        throw err;
      }
      // Window expired (stored ttl <= now, item not yet lazily deleted) — fall
      // through to the reset below.
    }

    // Step 2 — expired window: start a fresh one (count = 1, fresh ttl).
    try {
      await this.deps.client.send(
        new PutCommand({
          TableName: this.deps.tableName,
          Item: { sourceIp, count: 1, ttl },
          // Guard the race: only overwrite if STILL expired/absent, so a
          // concurrent live increment that revived the window is not reset.
          ConditionExpression: 'attribute_not_exists(#ttl) OR #ttl <= :now',
          ExpressionAttributeNames: { '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':now': now },
        }),
      );
      return 1;
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Another connect already revived the window between our UpdateItem and
        // this Put. Treat as a fresh-window connect (count ~1) — best-effort.
        return 1;
      }
      const category = categoriseDdbError(err);
      this.deps.log({
        buildSha: this.deps.buildSha,
        category,
        op: 'ConnectAttempts.reset',
        sourceIp,
      });
      throw err;
    }
  }
}
