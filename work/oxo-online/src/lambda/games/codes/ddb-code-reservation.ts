import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CodeCollision, type CodeReservationPort } from './ports';

/**
 * ddb-code-reservation.ts — ADAPTER implementing CodeReservationPort over
 * DynamoDB (§41, s005-h3 / delta 009). The reserve write is a SINGLE conditional
 * PutItem whose ConditionExpression is `attribute_not_exists(code)`. Because
 * `code` is the PK of the Codes table, this is a TRUE single-item compare-and-
 * swap: the first writer to claim a code value wins atomically; a concurrent
 * second writer gets ConditionalCheckFailedException → mapped to CodeCollision.
 * This is the storage-enforced uniqueness invariant (no in-memory race window).
 *
 * Reject-over-retry (delta §3 / §5a): a ConditionalCheckFailed is the BUSINESS
 * collision branch surfaced as a typed CodeCollision (the handler redraws once,
 * the adapter does NOT retry). Any OTHER backend error (throttling, 5xx, timeout)
 * is NOT a collision — it propagates as-is so the handler breaks straight to its
 * 5xx path, never masking an infra fault as a redraw. The SDK's own transient
 * retry (default adaptive, jittered) still applies to the underlying PutItem.
 *
 * Code↔policy pin (AC-5 / S5): this adapter issues ONLY PutItem against the Codes
 * table — exactly the granted action. No Get/Update/Delete/Query/Scan. The test
 * asserts no ungranted command type is ever issued so code cannot silently
 * diverge into a prod AccessDenied.
 */

/** TTL on a reservation: 24h, matching the Games TTL — orphans self-delete. */
const RESERVATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * The reserve CAS condition string — pinned in a test (AC-6) so the atomic
 * uniqueness gate cannot be silently removed. The local in-memory adapter CANNOT
 * enforce real DynamoDB conditional atomicity under genuine concurrency; this pin
 * + the tester's AC-2 50-concurrent prod proof cover that `codes` platform-gate gap.
 */
export const CODES_RESERVE_CONDITION_EXPRESSION = 'attribute_not_exists(code)';

export type LogFn = (line: Record<string, unknown>) => void;

export interface DdbCodeReservationDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  buildSha: string;
  log: LogFn;
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}

/** Availability-vs-our-defect split for a DynamoDB SDK error (4xx = INTERNAL). */
function categoriseDdbError(err: unknown): 'INTERNAL' | 'EXTERNAL_DEPENDENCY' {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return 'INTERNAL';
  }
  return 'EXTERNAL_DEPENDENCY';
}

export class DdbCodeReservation implements CodeReservationPort {
  constructor(private readonly deps: DdbCodeReservationDeps) {}

  async reserve(code: string, gameId: string): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + RESERVATION_TTL_SECONDS;
    try {
      await this.deps.client.send(
        new PutCommand({
          TableName: this.deps.tableName,
          Item: { code, gameId, ttl },
          ConditionExpression: CODES_RESERVE_CONDITION_EXPRESSION,
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Business collision — the ONLY retryable branch. Caller redraws a fresh
        // code; the adapter does NOT retry. No partial write occurred.
        this.deps.log({
          event: 'code_reservation_collision',
          buildSha: this.deps.buildSha,
          category: 'data',
          code,
        });
        throw new CodeCollision();
      }
      // Non-collision backend failure (throttling / 5xx / timeout) — NOT a
      // collision. Propagate as-is so the handler hits its 5xx path; never mask
      // an infra fault as a redraw.
      this.deps.log({
        event: 'code_reservation_write_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Codes.reserve',
      });
      throw err;
    }
  }
}
