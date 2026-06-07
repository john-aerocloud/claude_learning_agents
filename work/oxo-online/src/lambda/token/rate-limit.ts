/**
 * rate-limit.ts — DOMAIN (pure). Per-IP connect budget decision.
 *
 * Hexagonal (§41): zero SDK / transport imports. Given the post-increment
 * connect count for a source IP and the configured threshold, decide whether
 * this connect is within budget. The counting itself (the DynamoDB ADD) lives
 * behind the ConnectCounterPort adapter; this module only judges the number.
 */

export type RateDecision = 'Allow' | 'Deny';

/**
 * decideRateLimit — Deny once the post-increment count has reached the
 * threshold (so the threshold-th connect is the first denied), Allow below it.
 * @param count post-increment connect count for the source IP
 * @param threshold per-IP budget
 */
export function decideRateLimit(count: number, threshold: number): RateDecision {
  return count >= threshold ? 'Deny' : 'Allow';
}
