import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import {
  SsmSecretSource,
  __resetSsmSecretCacheForTests,
} from './ssm-secret-source';

// S-A2.6-adjacent — the authorizer's SecretSource adapter (ws-auth-owned, to
// keep UC2 file-disjoint from UC1's token/adapters copy). Reads the shared SSM
// SecureString WithDecryption, module-caches, categorises failures. The secret
// VALUE is never logged.

const ssmMock = mockClient(SSMClient);
let logs: Array<Record<string, unknown>>;

beforeEach(() => {
  ssmMock.reset();
  __resetSsmSecretCacheForTests();
  logs = [];
});

function source() {
  return new SsmSecretSource({
    client: ssmMock as unknown as SSMClient,
    paramName: '/oxo-online/prod/ws-token-secret',
    buildSha: 'abc1234',
    log: (l) => logs.push(l),
  });
}

describe('SsmSecretSource.get', () => {
  it('reads the parameter WithDecryption and returns its value', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'sek' } });
    expect(await source().get()).toBe('sek');
    const input = ssmMock.commandCalls(GetParameterCommand)[0].args[0].input;
    expect(input.Name).toBe('/oxo-online/prod/ws-token-secret');
    expect(input.WithDecryption).toBe(true);
  });

  it('module-caches: a second get does not call SSM again', async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: 'sek' } });
    const s = source();
    await s.get();
    await s.get();
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
  });

  it('5xx after retry → EXTERNAL_DEPENDENCY log + throw, secret never logged', async () => {
    ssmMock.on(GetParameterCommand).rejects(
      Object.assign(new Error('boom'), { $metadata: { httpStatusCode: 500 } }),
    );
    await expect(source().get()).rejects.toThrow();
    expect(logs[0].category).toBe('EXTERNAL_DEPENDENCY');
    expect(logs[0].buildSha).toBe('abc1234');
  });

  it('4xx → INTERNAL', async () => {
    ssmMock.on(GetParameterCommand).rejects(
      Object.assign(new Error('bad'), { $metadata: { httpStatusCode: 400 } }),
    );
    await expect(source().get()).rejects.toThrow();
    expect(logs[0].category).toBe('INTERNAL');
  });
});
