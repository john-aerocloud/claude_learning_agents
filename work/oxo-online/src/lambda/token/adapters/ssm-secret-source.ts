import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { SecretSource } from '../ports';

/**
 * ssm-secret-source.ts — ADAPTER (token/adapters). Implements the domain
 * SecretSource port over SSM SecureString GetParameter(WithDecryption).
 * Shared by oxo-game-fn (mint, UC1) and oxo-ws-auth-fn (verify, UC2): both read
 * the SAME parameter (named by env WS_TOKEN_SECRET_PARAM) so mint and verify
 * provably use the same key (SYNTH-CONTRACT-H2-2).
 *
 * §41 failure taxonomy: the SSM call categorises failures so support can split
 * internal-vs-external mechanically. Logging is structured and TESTED.
 * The secret VALUE is never logged.
 */

// Reuse the client across warm invocations.
const ssm = new SSMClient({});

// Module-scope cache: the secret is fetched once per cold start and reused
// across warm invocations (delta §4 — amortises the GetParameter cost).
let cached: string | undefined;

/** Test-only: clear the module cache between cases. */
export function __resetSecretCacheForTests(): void {
  cached = undefined;
}

function buildSha(): string {
  return process.env.BUILD_SHA ?? 'unknown';
}

function logFailure(category: 'EXTERNAL_DEPENDENCY' | 'INTERNAL', detail: string): void {
  // Structured, category-bearing line. NEVER includes the secret value.
  console.error(
    JSON.stringify({
      event: 'secret-fetch-failed',
      failureCategory: category,
      detail,
      buildSha: buildSha(),
    }),
  );
}

export function createSsmSecretSource(): SecretSource {
  return {
    async get(): Promise<string> {
      if (cached !== undefined) return cached;

      const name = process.env.WS_TOKEN_SECRET_PARAM;
      if (!name) {
        // Misconfiguration on our side — internal failure (bad request we built).
        logFailure('INTERNAL', 'WS_TOKEN_SECRET_PARAM env var not set');
        throw new Error('WS_TOKEN_SECRET_PARAM env var not set');
      }

      let value: string | undefined;
      try {
        const res = await ssm.send(
          new GetParameterCommand({ Name: name, WithDecryption: true }),
        );
        value = res.Parameter?.Value;
      } catch (err: unknown) {
        const status =
          (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
            ?.httpStatusCode ?? 0;
        // 4xx from the service = WE built a bad request (our defect/data problem)
        // -> INTERNAL. 5xx/timeout/conn = the dependency is unavailable
        // -> EXTERNAL_DEPENDENCY (availability).
        const category =
          status >= 400 && status < 500 ? 'INTERNAL' : 'EXTERNAL_DEPENDENCY';
        logFailure(
          category,
          `SSM GetParameter failed (httpStatusCode=${status || 'none'})`,
        );
        throw new Error('Could not read ws-token secret');
      }

      if (value === undefined || value === '') {
        logFailure('INTERNAL', 'SSM returned an empty parameter value');
        throw new Error('ws-token secret is empty');
      }

      cached = value;
      return value;
    },
  };
}
