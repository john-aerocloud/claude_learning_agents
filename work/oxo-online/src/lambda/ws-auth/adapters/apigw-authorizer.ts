import type { AuthorizerInput, AuthorizerDecision } from '../authorizer';

/**
 * apigw-authorizer.ts — ADAPTER. Translates the APIGW WebSocket REQUEST
 * authorizer event into the domain input, and the domain decision into the
 * **WS REST-style IAM-policy** response.
 *
 * PINNED PLATFORM SEMANTIC (delta §5, T4): WebSocket REQUEST authorizers use
 * the REST-style policy document `{principalId, policyDocument:{Version,
 * Statement:[{Action:'execute-api:Invoke', Effect, Resource:methodArn}]}}` —
 * NOT the HTTP-API-v2 `{isAuthorized}` shape. This is the ONLY place that shape
 * exists; the domain never sees policyDocument/methodArn.
 */

export interface WsAuthRequestEvent {
  methodArn: string;
  queryStringParameters?: Record<string, string | undefined> | null;
  requestContext: { identity: { sourceIp: string } };
}

export interface WsAuthPolicyResponse {
  principalId: string;
  policyDocument: {
    Version: '2012-10-17';
    Statement: Array<{
      Action: 'execute-api:Invoke';
      Effect: 'Allow' | 'Deny';
      Resource: string;
    }>;
  };
  context?: { gameId?: string; role?: string };
}

/**
 * eventToInput — pull the domain input from the REQUEST event. The per-IP key
 * (S6) is taken from requestContext.identity.sourceIp ONLY; a same-named query
 * param is never used as the key.
 */
export function eventToInput(event: WsAuthRequestEvent): AuthorizerInput {
  const qs = event.queryStringParameters ?? {};
  return {
    wsToken: qs.wsToken ?? undefined,
    code: qs.code ?? undefined,
    sourceIp: event.requestContext.identity.sourceIp,
  };
}

/**
 * decisionToPolicy — map a domain decision to the WS REST IAM-policy response.
 */
export function decisionToPolicy(
  decision: AuthorizerDecision,
  methodArn: string,
): WsAuthPolicyResponse {
  const response: WsAuthPolicyResponse = {
    principalId: decision.principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: decision.effect,
          Resource: methodArn,
        },
      ],
    },
  };
  if (decision.context) response.context = decision.context;
  return response;
}
