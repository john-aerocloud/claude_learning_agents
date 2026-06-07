import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * token.ts — DOMAIN (pure). The ubiquitous-language token module shared by
 * oxo-game-fn (mint, UC1) and oxo-ws-auth-fn (verify, UC2).
 *
 * Hexagonal (§41): zero SDK / transport / persistence imports. Only Node's
 * crypto primitive (HMAC-SHA256) — the cryptographic core of the domain
 * concept, not an external system. Clock is INJECTED (now in epoch seconds)
 * so the logic is deterministic and unit-testable with a fixed clock.
 */

const TOKEN_TTL_SECONDS = 60;

export interface HostTokenClaims {
  gameId: string;
  role: 'host';
}

export interface TokenPayload extends HostTokenClaims {
  /** Expiry, epoch seconds. */
  exp: number;
}

export type VerifyResult =
  | { valid: true; payload: TokenPayload }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' };

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest());
}

/**
 * mint — produce a short-lived host token `<b64url(payload)>.<b64url(sig)>`.
 * @param claims host claims (gameId + role:'host')
 * @param secret shared HMAC-SHA256 key
 * @param now    current time, epoch seconds (injected clock)
 */
export function mint(
  claims: HostTokenClaims,
  secret: string,
  now: number,
): string {
  const payload: TokenPayload = {
    gameId: claims.gameId,
    role: claims.role,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sigB64 = sign(payloadB64, secret);
  return `${payloadB64}.${sigB64}`;
}

/**
 * verify — validate signature (constant-time) then expiry.
 * Returns a discriminated Result; never throws on attacker-controlled input.
 * @param now current time, epoch seconds (injected clock)
 */
export function verify(
  token: string,
  secret: string,
  now: number,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    return { valid: false, reason: 'malformed' };
  }
  const [payloadB64, sigB64] = parts;

  const expectedSigB64 = sign(payloadB64, secret);
  // Constant-time compare. Length-mismatch short-circuits BEFORE timingSafeEqual
  // (which throws on unequal lengths) — a length difference already means the
  // signature is wrong, so this leaks nothing beyond "wrong".
  const given = Buffer.from(sigB64);
  const expected = Buffer.from(expectedSigB64);
  if (
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    return { valid: false, reason: 'bad-signature' };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as TokenPayload;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (typeof payload.exp !== 'number' || now > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}
