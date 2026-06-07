import { verify } from '../token/token';
import { decideRateLimit } from '../token/rate-limit';
import type {
  SecretSource,
  ConnectCounterPort,
  GameLookupPort,
  ExemptionPort,
} from './ports';

/**
 * authorizer.ts — DOMAIN orchestration for the $connect authorizer.
 *
 * Hexagonal (§41): imports only domain (token verify, rate-limit decision) and
 * the ports it defines — no SDK, no APIGW event/policy types. It returns a
 * domain DECISION; the concrete APIGW REQUEST event → input mapping and the WS
 * REST IAM-policy response shape (delta §5) live ONLY in the adapter.
 *
 * Failure taxonomy (§41): credential/validation failures (no credential, bad
 * token, code-not-found) are 4xx-class VALIDATION (caller/data problem);
 * over-budget is RATE_LIMIT. Each Deny emits a structured category field. The
 * secret is never logged. buildSha is on every line (T9).
 */

export interface AuthorizerInput {
  /** Host credential from the connect query string (server-derived presence). */
  wsToken?: string;
  /** Guest credential from the connect query string. */
  code?: string;
  /** Server-derived source IP (never a client header) — the per-IP key (S6). */
  sourceIp: string;
}

export interface AuthorizerDecision {
  effect: 'Allow' | 'Deny';
  /** Opaque principal: gameId for a host, 'guest' for a code, 'anon' on Deny. */
  principalId: string;
  context?: { gameId?: string; role?: string };
}

export type LogLine = Record<string, unknown>;

export interface AuthorizerDeps {
  secretSource: SecretSource;
  counter: ConnectCounterPort;
  lookup: GameLookupPort;
  /** Per-IP rate-limit exemption — consulted ONLY on the over-budget path (s007a). */
  exemption: ExemptionPort;
  threshold: number;
  now: () => number;
  buildSha: string;
  log: (line: LogLine) => void;
}

export async function authorize(
  input: AuthorizerInput,
  deps: AuthorizerDeps,
): Promise<AuthorizerDecision> {
  const { sourceIp } = input;

  // Rate check FIRST and ALWAYS — every connect increments the per-IP counter
  // (cache TTL 0 makes this accurate). The rate decision wins over credential
  // validity (AC2.9): a valid token from an over-budget IP is still denied.
  const count = await deps.counter.increment(sourceIp);
  if (decideRateLimit(count, deps.threshold) === 'Deny') {
    // s007a (DEFECT-S007-001) — over-budget path ONLY: consult the per-IP
    // exemption (zero happy-path reads). A LIVE exemption (item exists AND
    // ttl > now — the adapter evaluates expiry, fail-closed on error) WAIVES the
    // RATE_LIMIT Deny and the connect FALLS THROUGH to credential validation
    // below. It NEVER bypasses token/code validation. A non-exempt over-budget IP
    // (every prod/attacker IP) Denies exactly as before — no rate-exempt line.
    const exempt = await deps.exemption.isExempt(sourceIp, deps.now());
    if (!exempt) {
      return deny(deps, 'RATE_LIMIT', 'rate-limit-exceeded', { sourceIp, count });
    }
    // Exemption applied — attributable to a build, visible in CloudWatch, and the
    // carrier for the negative test that prod traffic never logs rate-exempt.
    deps.log({
      buildSha: deps.buildSha,
      effect: 'Allow',
      reason: 'rate-exempt',
      sourceIp,
      count,
    });
  }

  // Host token path.
  if (input.wsToken) {
    const secret = await deps.secretSource.get();
    const result = verify(input.wsToken, secret, deps.now());
    if (!result.valid) {
      return deny(deps, 'VALIDATION', result.reason, { sourceIp });
    }
    allowLog(deps, { sourceIp, role: 'host', gameId: result.payload.gameId });
    return {
      effect: 'Allow',
      principalId: result.payload.gameId,
      context: { gameId: result.payload.gameId, role: result.payload.role },
    };
  }

  // Guest code path.
  if (input.code) {
    const game = await deps.lookup.findByCode(input.code);
    if (game === null) {
      return deny(deps, 'VALIDATION', 'code-not-found', { sourceIp });
    }
    allowLog(deps, { sourceIp, role: 'guest' });
    return {
      effect: 'Allow',
      principalId: 'guest',
      context: { role: 'guest' },
    };
  }

  // No credential presented at all.
  return deny(deps, 'VALIDATION', 'no-credential', { sourceIp });
}

function deny(
  deps: AuthorizerDeps,
  category: 'RATE_LIMIT' | 'VALIDATION' | 'EXTERNAL_DEPENDENCY' | 'INTERNAL',
  reason: string,
  fields: LogLine,
): AuthorizerDecision {
  deps.log({
    buildSha: deps.buildSha,
    effect: 'Deny',
    category,
    reason,
    ...fields,
  });
  return { effect: 'Deny', principalId: 'anon' };
}

function allowLog(deps: AuthorizerDeps, fields: LogLine): void {
  deps.log({ buildSha: deps.buildSha, effect: 'Allow', ...fields });
}
