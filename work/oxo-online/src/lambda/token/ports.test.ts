import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretSource } from './ports';

/**
 * S-A1.3 — the SecretSource port is a DOMAIN interface in domain terms.
 * A fake satisfies it with zero infrastructure (proves the games handler can
 * depend on the port, not on SSM).
 */
describe('SecretSource port (S-A1.3, S3)', () => {
  it('is satisfiable by a pure in-memory fake', async () => {
    const fake: SecretSource = { get: async () => 'in-memory-secret' };
    await expect(fake.get()).resolves.toBe('in-memory-secret');
  });

  it('domain modules import nothing concrete (no SDK/transport imports)', () => {
    // Hexagonal guard: the domain centre (token.ts, ports.ts) must not import
    // any AWS SDK, aws-lambda transport types, or DynamoDB/SSM client. Adapters
    // (token/adapters/*) MAY. This pins concept-leakage out of the domain.
    const dir = join(__dirname);
    for (const file of ['token.ts', 'ports.ts']) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src).not.toMatch(/@aws-sdk/);
      expect(src).not.toMatch(/aws-lambda/);
      expect(src).not.toMatch(/client-dynamodb|lib-dynamodb|client-ssm|client-secrets-manager/);
    }
  });
});
