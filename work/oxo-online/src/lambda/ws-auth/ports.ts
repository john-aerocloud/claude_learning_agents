/**
 * ports.ts (ws-auth) — DOMAIN-defined ports for the $connect authorizer, in
 * domain terms (§41). Adapters under ./adapters implement these over concrete
 * external systems (DynamoDB, SSM/Secrets Manager). Domain imports nothing
 * concrete; it is unit-tested with fakes of these interfaces.
 *
 * SecretSource is intentionally re-declared here as the authorizer's required
 * shape (a structural `get(): Promise<string>`); the shared SSM adapter A1
 * lands satisfies it structurally — keeping ws-auth's port surface owned by
 * ws-auth and avoiding a contested edit of token/ports.ts.
 */

/** Source of the shared HMAC secret (encrypted-at-rest store behind it). */
export interface SecretSource {
  get(): Promise<string>;
}

/**
 * Per-IP connect counter. increment performs the atomic ADD (+ first-write TTL)
 * and returns the new post-increment count for that source IP.
 */
export interface ConnectCounterPort {
  increment(sourceIp: string): Promise<number>;
}

/** Looks a game up by its join code; null when no such code exists. */
export interface GameLookupPort {
  findByCode(code: string): Promise<{ status: string } | null>;
}

/**
 * Per-IP rate-limit exemption (s007a, DEFECT-S007-001). Reports whether a LIVE
 * exemption exists for the given source IP at time `now`. "Live" means an
 * exemption item exists AND its TTL is still in the future — the adapter
 * evaluates `ttl > now` itself and NEVER trusts DynamoDB's lazy delete
 * (DEFECT-H2-003). Consulted by the authorizer ONLY on the would-be RATE_LIMIT
 * Deny path (zero happy-path reads). Fail-closed: on a read error the adapter
 * returns false so the RATE_LIMIT Deny stands (an unavailable exemption store
 * never weakens the control). The exemption waives ONLY the rate Deny — token
 * and code validation still apply.
 */
export interface ExemptionPort {
  isExempt(sourceIp: string, now: number): Promise<boolean>;
}
