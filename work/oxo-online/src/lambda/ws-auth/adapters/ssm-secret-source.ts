import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { SecretSource } from '../ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * ssm-secret-source.ts — ADAPTER (ws-auth). Implements the SecretSource port
 * over SSM SecureString GetParameter(WithDecryption). Reads the SAME parameter
 * (named by env WS_TOKEN_SECRET_PARAM) the minting fn uses, so verify and mint
 * provably share the key (SYNTH-CONTRACT-H2-2). Module-scope cache amortises
 * the cold-start fetch (delta §4). §41 taxonomy; the secret VALUE is never
 * logged (S3). categoriseDdbError maps http status → category for any AWS SDK
 * error (the 4xx/5xx split is service-agnostic).
 */

let cached: string | undefined;

/** Test-only: clear the module cache between cases. */
export function __resetSsmSecretCacheForTests(): void {
  cached = undefined;
}

export interface SsmSecretSourceDeps {
  client: SSMClient;
  paramName: string;
  buildSha: string;
  log: LogFn;
}

export class SsmSecretSource implements SecretSource {
  constructor(private readonly deps: SsmSecretSourceDeps) {}

  async get(): Promise<string> {
    if (cached !== undefined) return cached;
    try {
      const out = await this.deps.client.send(
        new GetParameterCommand({
          Name: this.deps.paramName,
          WithDecryption: true,
        }),
      );
      const value = out.Parameter?.Value;
      if (!value) {
        throw new Error('ws-token secret parameter has no value');
      }
      cached = value;
      return value;
    } catch (err) {
      this.deps.log({
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'SecretSource.get',
        // NEVER log the secret value.
      });
      throw err;
    }
  }
}
