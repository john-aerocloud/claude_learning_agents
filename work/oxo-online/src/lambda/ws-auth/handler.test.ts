import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBDocumentClient,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { mint } from '../token/token';
import { handler } from './handler';

// Composition-root test: the deployed entry point wires the real adapters and
// returns the PINNED WS REST IAM-policy shape (T4) end-to-end through the
// domain. Externals (DynamoDB, SSM) are mocked at the SDK boundary.

const ddbMock = mockClient(DynamoDBDocumentClient);
const ssmMock = mockClient(SSMClient);
const SECRET = 'compose-secret';
const METHOD_ARN =
  'arn:aws:execute-api:eu-west-2:123456789012:abc/prod/$connect';

beforeEach(() => {
  ddbMock.reset();
  ssmMock.reset();
  ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 1 } });
  ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: SECRET } });
  process.env.CONNECT_ATTEMPTS_TABLE = 'oxo-connect-attempts';
  process.env.GAMES_TABLE = 'oxo-games';
  process.env.GAMES_CODE_INDEX = 'code-index';
  process.env.WS_TOKEN_SECRET_PARAM = '/oxo-online/prod/ws-token-secret';
  process.env.CONNECT_RATE_THRESHOLD = '20';
  process.env.BUILD_SHA = 'deadbee';
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

function event(qs: Record<string, string>, sourceIp = '1.2.3.4') {
  return {
    methodArn: METHOD_ARN,
    queryStringParameters: qs,
    requestContext: { identity: { sourceIp } },
  } as never;
}

describe('handler — returns the WS REST IAM-policy shape end-to-end (T4)', () => {
  it('valid host token → Allow policy on the methodArn', async () => {
    const wsToken = mint(
      { gameId: 'g-1', role: 'host' },
      SECRET,
      Math.floor(Date.now() / 1000),
    );
    const res = await handler(event({ wsToken }));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(res.policyDocument.Statement[0].Action).toBe('execute-api:Invoke');
    expect(res.policyDocument.Statement[0].Resource).toBe(METHOD_ARN);
    expect('isAuthorized' in res).toBe(false);
  });

  it('no credential → Deny policy', async () => {
    const res = await handler(event({}));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});

describe('handler — s007a exemption wired end-to-end (DEFECT-S007-001)', () => {
  it('over-budget IP with a LIVE exemption + valid token → Allow (the runner unblocks)', async () => {
    const now = Math.floor(Date.now() / 1000);
    // Over budget: the counter returns count == threshold.
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 20 } });
    // A live exemption item exists for this IP (ttl in the future).
    ddbMock.on(GetCommand).resolves({ Item: { sourceIp: 'EXEMPT#7.7.7.7', ttl: now + 3600 } });
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, now);
    const res = await handler(event({ wsToken }, '7.7.7.7'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Allow');
  });

  it('over-budget IP with NO exemption → Deny (prod control intact)', async () => {
    const now = Math.floor(Date.now() / 1000);
    ddbMock.on(UpdateCommand).resolves({ Attributes: { count: 20 } });
    ddbMock.on(GetCommand).resolves({}); // no exemption item
    const wsToken = mint({ gameId: 'g-1', role: 'host' }, SECRET, now);
    const res = await handler(event({ wsToken }, '8.8.8.8'));
    expect(res.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});
