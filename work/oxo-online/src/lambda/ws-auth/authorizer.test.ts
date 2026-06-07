import { describe, it, expect, beforeEach, vi } from 'vitest';
import { authorize, type AuthorizerDeps } from './authorizer';
import { mint } from '../token/token';
import type {
  SecretSource,
  ConnectCounterPort,
  GameLookupPort,
  ExemptionPort,
} from './ports';

// S-A2.3 [AC2.3–AC2.9, T4-input-side, S6] — orchestration over port FAKES.
// Returns a DOMAIN decision { effect, principalId, context? } — never a policy
// document (the policy shape lives only in the adapter, T4). Logging is tested:
// every Deny emits a structured category field; buildSha on every line.

const SECRET = 'unit-test-shared-secret';
const NOW = 1_000_000;
const THRESHOLD = 5;
const BUILD_SHA = 'abc1234';

function fakeSecret(value = SECRET): SecretSource {
  return { get: () => Promise.resolve(value) };
}

function fakeCounter(count: number): ConnectCounterPort {
  return { increment: vi.fn(() => Promise.resolve(count)) };
}

function fakeLookup(
  result: { status: string } | null,
): GameLookupPort {
  return { findByCode: vi.fn(() => Promise.resolve(result)) };
}

function fakeExemption(exempt: boolean): ExemptionPort {
  return { isExempt: vi.fn(() => Promise.resolve(exempt)) };
}

let logs: Array<Record<string, unknown>>;
function captureLog(line: Record<string, unknown>): void {
  logs.push(line);
}

function deps(overrides: Partial<AuthorizerDeps> = {}): AuthorizerDeps {
  return {
    secretSource: fakeSecret(),
    counter: fakeCounter(1),
    lookup: fakeLookup({ status: 'waiting' }),
    exemption: fakeExemption(false),
    threshold: THRESHOLD,
    now: () => NOW,
    buildSha: BUILD_SHA,
    log: captureLog,
    ...overrides,
  };
}

beforeEach(() => {
  logs = [];
});

describe('authorize — credential branches over port fakes (AC2.3–AC2.8)', () => {
  it('AC2.3: valid host token → Allow', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const d = await authorize({ wsToken, sourceIp: '1.2.3.4' }, deps());
    expect(d.effect).toBe('Allow');
    expect(d.context?.gameId).toBe('g-1');
    expect(d.context?.role).toBe('host');
  });

  it('AC2.4: tampered token → Deny', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const tampered = wsToken.slice(0, -1) + (wsToken.endsWith('A') ? 'B' : 'A');
    const d = await authorize({ wsToken: tampered, sourceIp: '1.2.3.4' }, deps());
    expect(d.effect).toBe('Deny');
  });

  it('AC2.5: expired token → Deny', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const later = deps({ now: () => NOW + 9999 });
    const d = await authorize({ wsToken, sourceIp: '1.2.3.4' }, later);
    expect(d.effect).toBe('Deny');
  });

  it('AC2.6: valid guest code, game waiting → Allow', async () => {
    const d = await authorize(
      { code: 'ABC123', sourceIp: '1.2.3.4' },
      deps({ lookup: fakeLookup({ status: 'waiting' }) }),
    );
    expect(d.effect).toBe('Allow');
  });

  it('AC2.6: valid guest code, game active → Allow', async () => {
    const d = await authorize(
      { code: 'ABC123', sourceIp: '1.2.3.4' },
      deps({ lookup: fakeLookup({ status: 'active' }) }),
    );
    expect(d.effect).toBe('Allow');
  });

  it('AC2.7: code not found → Deny', async () => {
    const d = await authorize(
      { code: 'NOPE00', sourceIp: '1.2.3.4' },
      deps({ lookup: fakeLookup(null) }),
    );
    expect(d.effect).toBe('Deny');
  });

  it('AC2.8: no credential at all → Deny', async () => {
    const d = await authorize({ sourceIp: '1.2.3.4' }, deps());
    expect(d.effect).toBe('Deny');
  });
});

describe('authorize — rate check wins over credential validity (AC2.9, S6)', () => {
  it('AC2.9: count >= threshold → Deny even with a valid host token', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const d = await authorize(
      { wsToken, sourceIp: '9.9.9.9' },
      deps({ counter: fakeCounter(THRESHOLD) }),
    );
    expect(d.effect).toBe('Deny');
  });

  it('S6: the per-IP key passed to the counter is the server-derived sourceIp', async () => {
    const counter = fakeCounter(1);
    await authorize({ code: 'ABC123', sourceIp: '5.6.7.8' }, deps({ counter }));
    expect(counter.increment).toHaveBeenCalledWith('5.6.7.8');
  });
});

describe('authorize — categorised logging + buildSha (T9, §41 failure taxonomy)', () => {
  it('every log line carries buildSha', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    await authorize({ wsToken, sourceIp: '1.2.3.4' }, deps());
    expect(logs.length).toBeGreaterThan(0);
    for (const line of logs) expect(line.buildSha).toBe(BUILD_SHA);
  });

  it('rate-limit Deny logs category RATE_LIMIT', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    await authorize(
      { wsToken, sourceIp: '9.9.9.9' },
      deps({ counter: fakeCounter(THRESHOLD) }),
    );
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('RATE_LIMIT');
  });

  it('no-credential Deny logs category VALIDATION (4xx-class data problem)', async () => {
    await authorize({ sourceIp: '1.2.3.4' }, deps());
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('VALIDATION');
    expect(deny?.reason).toBe('no-credential');
  });

  it('bad token Deny logs category VALIDATION with the verify reason', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const tampered = wsToken.slice(0, -1) + (wsToken.endsWith('A') ? 'B' : 'A');
    await authorize({ wsToken: tampered, sourceIp: '1.2.3.4' }, deps());
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('VALIDATION');
    expect(deny?.reason).toBe('bad-signature');
  });

  it('code-not-found Deny logs category VALIDATION', async () => {
    await authorize(
      { code: 'NOPE00', sourceIp: '1.2.3.4' },
      deps({ lookup: fakeLookup(null) }),
    );
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('VALIDATION');
    expect(deny?.reason).toBe('code-not-found');
  });

  it('does not log the secret value (S3)', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    await authorize({ wsToken, sourceIp: '1.2.3.4' }, deps());
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });
});

// ===========================================================================
// s007a (DEFECT-S007-001) — per-IP runner exemption on the over-budget path.
// @covers ws-auth/exemption
// The exemption is consulted ONLY when the rate gate would Deny; a live
// exemption waives the RATE_LIMIT Deny and the connect falls through to credential
// validation (it NEVER bypasses token/code validation). Five pin classes; the
// fail-closed and expired-item branches are adapter-level (ddb-connect-exemption).
// ===========================================================================
describe('authorize — rate-limit exemption (s007a, DEFECT-S007-001)', () => {
  // S-AUTH-EXEMPT positive: over budget + live exemption + valid token → Allow.
  it('S-AUTH-EXEMPT: over-budget IP WITH a live exemption + valid host token → Allow', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const d = await authorize(
      { wsToken, sourceIp: '9.9.9.9' },
      deps({
        counter: fakeCounter(THRESHOLD),
        exemption: fakeExemption(true),
      }),
    );
    expect(d.effect).toBe('Allow');
    expect(d.context?.gameId).toBe('g-1');
  });

  it('S-AUTH-EXEMPT: an applied exemption logs a structured rate-exempt line with buildSha + count', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    await authorize(
      { wsToken, sourceIp: '9.9.9.9' },
      deps({ counter: fakeCounter(THRESHOLD), exemption: fakeExemption(true) }),
    );
    const exemptLine = logs.find((l) => l.reason === 'rate-exempt');
    expect(exemptLine, 'an applied exemption must emit a rate-exempt log line').toBeDefined();
    expect(exemptLine?.effect).toBe('Allow');
    expect(exemptLine?.buildSha).toBe(BUILD_SHA);
    expect(exemptLine?.sourceIp).toBe('9.9.9.9');
    expect(exemptLine?.count).toBe(THRESHOLD);
  });

  it('S-AUTH-EXEMPT: the exemption is keyed by the server-derived sourceIp and the current now', async () => {
    const exemption = fakeExemption(true);
    await authorize(
      { code: 'ABC123', sourceIp: '5.6.7.8' },
      deps({ counter: fakeCounter(THRESHOLD), exemption }),
    );
    expect(exemption.isExempt).toHaveBeenCalledWith('5.6.7.8', NOW);
  });

  // S-AUTH-EXEMPT-NEG: over budget + NO live exemption → Deny still stands.
  it('S-AUTH-EXEMPT-NEG: over-budget IP withOUT an exemption still Denies RATE_LIMIT', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    await authorize(
      { wsToken, sourceIp: '6.6.6.6' },
      deps({ counter: fakeCounter(THRESHOLD), exemption: fakeExemption(false) }),
    );
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('RATE_LIMIT');
    // No exemption was applied → no rate-exempt line is ever emitted (the
    // carrier assertion that prod traffic never logs rate-exempt).
    expect(logs.find((l) => l.reason === 'rate-exempt')).toBeUndefined();
  });

  // no-validation-bypass: a live exemption waives the RATE Deny but NOT
  // token/code validation — a bad token from an exempt IP still Denies VALIDATION.
  it('no-validation-bypass: exempt over-budget IP with a TAMPERED token still Denies VALIDATION', async () => {
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const tampered = wsToken.slice(0, -1) + (wsToken.endsWith('A') ? 'B' : 'A');
    const d = await authorize(
      { wsToken: tampered, sourceIp: '9.9.9.9' },
      deps({ counter: fakeCounter(THRESHOLD), exemption: fakeExemption(true) }),
    );
    expect(d.effect).toBe('Deny');
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('VALIDATION');
  });

  it('no-validation-bypass: exempt over-budget IP with an UNKNOWN code still Denies VALIDATION', async () => {
    const d = await authorize(
      { code: 'NOPE00', sourceIp: '9.9.9.9' },
      deps({
        counter: fakeCounter(THRESHOLD),
        exemption: fakeExemption(true),
        lookup: fakeLookup(null),
      }),
    );
    expect(d.effect).toBe('Deny');
    const deny = logs.find((l) => l.effect === 'Deny');
    expect(deny?.category).toBe('VALIDATION');
    expect(deny?.reason).toBe('code-not-found');
  });

  // happy-path-zero-read: under threshold → the exemption store is NEVER read.
  it('happy-path-zero-read: an under-budget connect NEVER consults the exemption port', async () => {
    const exemption = fakeExemption(true);
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, NOW);
    const d = await authorize(
      { wsToken, sourceIp: '1.2.3.4' },
      deps({ counter: fakeCounter(1), exemption }),
    );
    expect(d.effect).toBe('Allow');
    expect(exemption.isExempt).not.toHaveBeenCalled();
  });
});
