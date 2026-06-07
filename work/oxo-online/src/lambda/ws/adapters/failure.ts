/**
 * failure.ts — §41 failure-taxonomy helper for the ws-fn move adapters.
 *
 * Categories (structured log field `category` so metrics can split):
 *   - 'data'                — caller's problem: inbound validation / business
 *                             reject (out-of-turn, version CAS lost). 4xx-class.
 *   - 'INTERNAL'            — WE built a bad request to a dependency (4xx from
 *                             the dependency). Our defect / data problem.
 *   - 'EXTERNAL_DEPENDENCY' — dependency failed after retries (5xx / timeout /
 *                             conn-refused). Availability problem.
 */

export type FailureCategory = 'data' | 'INTERNAL' | 'EXTERNAL_DEPENDENCY';

export type LogFn = (line: Record<string, unknown>) => void;

/** Maps a DynamoDB SDK error to the availability-vs-our-defect split. */
export function categoriseDdbError(err: unknown): 'INTERNAL' | 'EXTERNAL_DEPENDENCY' {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return 'INTERNAL';
  }
  return 'EXTERNAL_DEPENDENCY';
}

export function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string })?.name === 'ConditionalCheckFailedException';
}
