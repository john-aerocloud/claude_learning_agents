/**
 * failure.ts — shared §41 failure-taxonomy helper for the ws-auth adapters.
 *
 * Maps an external-service error to the support category so metrics can split
 * internal-vs-external and data(4xx)-vs-availability(5xx):
 *   - 5xx / timeout / conn-refused (no http status) → EXTERNAL_DEPENDENCY
 *   - 4xx (we built a bad request — our defect/data) → INTERNAL
 */

export type FailureCategory = 'EXTERNAL_DEPENDENCY' | 'INTERNAL';

export type LogFn = (line: Record<string, unknown>) => void;

export function categoriseDdbError(err: unknown): FailureCategory {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return 'INTERNAL';
  }
  return 'EXTERNAL_DEPENDENCY';
}
