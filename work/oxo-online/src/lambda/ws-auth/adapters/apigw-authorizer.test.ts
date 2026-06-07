import { describe, it, expect } from 'vitest';
import {
  eventToInput,
  decisionToPolicy,
  type WsAuthRequestEvent,
} from './apigw-authorizer';
import type { AuthorizerDecision } from '../authorizer';

// S-A2.4 [T4, S6] — THE PINNED SHAPE. The WS REQUEST authorizer must return the
// REST-style IAM-policy document, NOT the HTTP-v2 { isAuthorized } shape
// (delta §5 — bitten twice). This adapter is the ONLY place that shape lives.

const METHOD_ARN =
  'arn:aws:execute-api:eu-west-2:123456789012:abc123/prod/$connect';

function event(
  qs: Record<string, string> | undefined,
  sourceIp = '1.2.3.4',
): WsAuthRequestEvent {
  return {
    methodArn: METHOD_ARN,
    queryStringParameters: qs,
    requestContext: { identity: { sourceIp } },
  };
}

describe('eventToInput — maps REQUEST event → domain input (S6)', () => {
  it('reads wsToken + code from the query string', () => {
    const input = eventToInput(
      event({ wsToken: 'TKN', code: 'ABC123' }),
    );
    expect(input.wsToken).toBe('TKN');
    expect(input.code).toBe('ABC123');
  });

  it('S6: sourceIp comes from requestContext.identity.sourceIp ONLY', () => {
    const input = eventToInput(event({ wsToken: 'TKN' }, '5.6.7.8'));
    expect(input.sourceIp).toBe('5.6.7.8');
  });

  it('S6: a client-supplied sourceIp query param is NOT used as the key', () => {
    const ev = event({ wsToken: 'TKN', sourceIp: '0.0.0.0' }, '5.6.7.8');
    const input = eventToInput(ev);
    expect(input.sourceIp).toBe('5.6.7.8');
  });

  it('handles a missing query string (no credential) without throwing', () => {
    const input = eventToInput(event(undefined));
    expect(input.wsToken).toBeUndefined();
    expect(input.code).toBeUndefined();
    expect(input.sourceIp).toBe('1.2.3.4');
  });
});

describe('decisionToPolicy — WS REST IAM-policy shape, NOT { isAuthorized } (T4)', () => {
  it('Allow → Effect Allow IAM policy on the methodArn', () => {
    const decision: AuthorizerDecision = {
      effect: 'Allow',
      principalId: 'g-1',
      context: { gameId: 'g-1', role: 'host' },
    };
    const policy = decisionToPolicy(decision, METHOD_ARN);
    expect(policy).toEqual({
      principalId: 'g-1',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: METHOD_ARN,
          },
        ],
      },
      context: { gameId: 'g-1', role: 'host' },
    });
  });

  it('Deny → Effect Deny IAM policy on the methodArn', () => {
    const policy = decisionToPolicy(
      { effect: 'Deny', principalId: 'anon' },
      METHOD_ARN,
    );
    expect(policy.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(policy.policyDocument.Statement[0].Action).toBe('execute-api:Invoke');
    expect(policy.policyDocument.Statement[0].Resource).toBe(METHOD_ARN);
  });

  it('is NOT the HTTP-v2 simple shape — no isAuthorized key anywhere', () => {
    const policy = decisionToPolicy(
      { effect: 'Allow', principalId: 'g-1' },
      METHOD_ARN,
    );
    expect('isAuthorized' in policy).toBe(false);
    expect(JSON.stringify(policy)).not.toContain('isAuthorized');
    expect(policy.policyDocument.Version).toBe('2012-10-17');
  });

  it('omits context when the decision carries none', () => {
    const policy = decisionToPolicy(
      { effect: 'Deny', principalId: 'anon' },
      METHOD_ARN,
    );
    expect(policy.context).toBeUndefined();
  });
});
