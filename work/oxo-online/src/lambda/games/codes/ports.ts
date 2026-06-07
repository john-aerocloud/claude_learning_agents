/**
 * ports.ts (codes) — DOMAIN-defined port for the create-game code-uniqueness
 * reservation seam, expressed in domain terms (§41 hexagonal). The DynamoDB
 * adapter (prod) and the in-memory adapter (local stand-up + unit injection)
 * implement this interface over concrete external systems. Domain/handler code
 * imports NOTHING concrete from a reservation backend: no AWS SDK, no DynamoDB
 * AttributeValue, no ConditionalCheckFailedException type — only `reserve` and
 * the typed `CodeCollision`.
 *
 * s005-h3 (delta 009, OI-3). The create handler today writes Games via a
 * module-global `ddb` client with NO port (unlike the move flow's GameStorePort).
 * This port is the hexagonal seam that makes the conditional-reserve BRANCH
 * reproducible locally and unit-testable (AC-1 injection, AC-4 retry-cap).
 */

/**
 * Code-reservation port — a write-time uniqueness GATE.
 *
 * `reserve(code, gameId)` atomically claims `code` for `gameId`. On success the
 * code is exclusively this game's. On a collision (the code is already reserved
 * by a concurrent/prior create) it throws a typed `CodeCollision` — the ONLY
 * retryable branch. Any other backend failure propagates as-is (it is NOT a
 * collision; the handler must not mask an infra fault as a redraw — delta §3 /
 * §5a). The DynamoDB adapter enforces uniqueness with a single-item CAS
 * (conditional PutItem `attribute_not_exists(code)`); the local adapter
 * reproduces only the reject BRANCH SHAPE (§12a — a JS map cannot reproduce real
 * DynamoDB conditional atomicity under genuine concurrency; that guarantee is
 * covered by the AC-6 ConditionExpression pin + the tester's AC-2 50-concurrent
 * real-DynamoDB proof, NOT by the local adapter).
 */
export interface CodeReservationPort {
  reserve(code: string, gameId: string): Promise<void>;
}

/**
 * Raised by CodeReservationPort.reserve when the code is already reserved (the
 * conditional PutItem's `attribute_not_exists(code)` failed). A legitimate
 * collision outcome — the handler redraws a fresh code and retries (bounded).
 * It is NOT an error condition to surface to the client (the retry is invisible).
 */
export class CodeCollision extends Error {
  constructor(message = 'code already reserved') {
    super(message);
    this.name = 'CodeCollision';
  }
}
