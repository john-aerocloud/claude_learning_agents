import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { createSsmSecretSource, __resetSecretCacheForTests } from './ssm-secret-source';

/**
 * S-A1.6 — SsmSecretSource ADAPTER (shared by oxo-game-fn mint + oxo-ws-auth-fn
 * verify). Maps SSM GetParameter(WithDecryption) -> secret string; module-caches
 * across warm invocations; categorises failures per §41 (EXTERNAL_DEPENDENCY
 * for 5xx/timeout, INTERNAL for a 4xx-class bad request). Logging IS TESTED.
 */
const ssmMock = mockClient(SSMClient);
const PARAM_NAME = '/oxo-online/prod/ws-token-secret';
const SECRET_VALUE = 'decrypted-shared-hmac-secret-32!!';

beforeEach(() => {
  ssmMock.reset();
  __resetSecretCacheForTests();
  process.env.WS_TOKEN_SECRET_PARAM = PARAM_NAME;
  process.env.BUILD_SHA = 'test-sha';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SsmSecretSource adapter (S-A1.6, S3)', () => {
  it('reads the parameter named by WS_TOKEN_SECRET_PARAM with decryption and returns the value', async () => {
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: SECRET_VALUE } });

    const source = createSsmSecretSource();
    await expect(source.get()).resolves.toBe(SECRET_VALUE);

    const calls = ssmMock.commandCalls(GetParameterCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input.Name).toBe(PARAM_NAME);
    expect(calls[0].args[0].input.WithDecryption).toBe(true);
  });

  it('module-caches the value: a second get() does NOT call SSM again', async () => {
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: SECRET_VALUE } });

    const source = createSsmSecretSource();
    await source.get();
    await source.get();
    await source.get();

    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);
  });

  it('NEVER logs the secret value', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    ssmMock
      .on(GetParameterCommand)
      .resolves({ Parameter: { Value: SECRET_VALUE } });

    await createSsmSecretSource().get();

    for (const call of logSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_VALUE);
    }
  });

  it('on an SSM 5xx/timeout categorises EXTERNAL_DEPENDENCY and throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('service unavailable'), {
      $metadata: { httpStatusCode: 503 },
    });
    ssmMock.on(GetParameterCommand).rejects(err);

    await expect(createSsmSecretSource().get()).rejects.toThrow();

    const logged = errSpy.mock.calls.map((c) => c[0]);
    const line = logged.find(
      (l) => typeof l === 'string' && l.includes('EXTERNAL_DEPENDENCY'),
    ) as string | undefined;
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string);
    expect(parsed.failureCategory).toBe('EXTERNAL_DEPENDENCY');
    expect(parsed.buildSha).toBe('test-sha');
    expect(JSON.stringify(parsed)).not.toContain(SECRET_VALUE);
  });

  it('on an SSM 4xx (our bad request) categorises INTERNAL and throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('ParameterNotFound'), {
      $metadata: { httpStatusCode: 400 },
    });
    ssmMock.on(GetParameterCommand).rejects(err);

    await expect(createSsmSecretSource().get()).rejects.toThrow();

    const logged = errSpy.mock.calls.map((c) => c[0]);
    const line = logged.find(
      (l) => typeof l === 'string' && l.includes('INTERNAL'),
    ) as string | undefined;
    expect(line).toBeDefined();
    const parsed = JSON.parse(line as string);
    expect(parsed.failureCategory).toBe('INTERNAL');
    expect(parsed.buildSha).toBe('test-sha');
  });

  it('throws if WS_TOKEN_SECRET_PARAM is not set (misconfiguration)', async () => {
    delete process.env.WS_TOKEN_SECRET_PARAM;
    await expect(createSsmSecretSource().get()).rejects.toThrow();
  });
});
