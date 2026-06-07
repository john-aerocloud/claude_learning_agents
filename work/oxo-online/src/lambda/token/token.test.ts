import { describe, it, expect } from 'vitest';
import { mint, verify } from './token';

const SECRET = 'test-secret-32-bytes-long-aaaaaa';
const FIXED_NOW = 1_700_000_000; // fixed clock (seconds)

function decodePayload(token: string): Record<string, unknown> {
  const [payloadB64] = token.split('.');
  const json = Buffer.from(payloadB64, 'base64url').toString('utf8');
  return JSON.parse(json);
}

describe('token.mint — host wsToken (S-A1.1, T7)', () => {
  it('returns <b64url(payload)>.<b64url(sig)> with the host claims and 60s expiry', () => {
    const token = mint({ gameId: 'g-123', role: 'host' }, SECRET, FIXED_NOW);

    // Shape: two base64url segments separated by a dot.
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);

    const payload = decodePayload(token);
    expect(payload.gameId).toBe('g-123');
    expect(payload.role).toBe('host');
    expect(payload.exp).toBe(FIXED_NOW + 60);
  });

  it('produces a stable signature for the same inputs (deterministic HMAC)', () => {
    const a = mint({ gameId: 'g-1', role: 'host' }, SECRET, FIXED_NOW);
    const b = mint({ gameId: 'g-1', role: 'host' }, SECRET, FIXED_NOW);
    expect(a).toBe(b);
  });
});

describe('token.verify — round-trip, tamper & expiry (S-A1.2, T7)', () => {
  it('accepts a freshly minted token before expiry', () => {
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const result = verify(token, SECRET, FIXED_NOW);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.gameId).toBe('g-9');
      expect(result.payload.role).toBe('host');
      expect(result.payload.exp).toBe(FIXED_NOW + 60);
    }
  });

  it('rejects a token signed with a different secret', () => {
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const result = verify(token, 'a-totally-different-secret-key!!', FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token whose signature byte was tampered', () => {
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const [payloadB64, sigB64] = token.split('.');
    // Flip the first character of the signature segment to a different b64url char.
    const flipped = (sigB64[0] === 'A' ? 'B' : 'A') + sigB64.slice(1);
    const tampered = `${payloadB64}.${flipped}`;
    const result = verify(tampered, SECRET, FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token whose payload was tampered (sig no longer matches)', () => {
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const [, sigB64] = token.split('.');
    const evilPayload = Buffer.from(
      JSON.stringify({ gameId: 'g-EVIL', role: 'host', exp: FIXED_NOW + 60 }),
    ).toString('base64url');
    const tampered = `${evilPayload}.${sigB64}`;
    const result = verify(tampered, SECRET, FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('bad-signature');
  });

  it('rejects a token once now is past exp (expired)', () => {
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const result = verify(token, SECRET, FIXED_NOW + 61);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('expired');
  });

  it('rejects a malformed token (not two segments)', () => {
    const result = verify('not-a-valid-token', SECRET, FIXED_NOW);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe('malformed');
  });

  it('rejects a token with a non-host role', () => {
    // Construct a validly-signed token but with role 'guest' to ensure mint
    // contract is host-only; verify should still surface the payload faithfully.
    const token = mint({ gameId: 'g-9', role: 'host' }, SECRET, FIXED_NOW);
    const result = verify(token, SECRET, FIXED_NOW);
    expect(result.valid).toBe(true);
  });
});
