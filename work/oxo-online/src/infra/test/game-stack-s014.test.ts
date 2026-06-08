import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';

/**
 * game-stack-s014.test.ts — s014 in-game chat synth contract (delta 011).
 *
 * @covers chat-handler
 * @covers wsfn
 *
 * The chat route is ADDITIVE: ONE new `chat` route key on the EXISTING WS API →
 * the EXISTING oxo-ws-fn. The architect-confirmed negatives (delta 011 §1) are
 * the load-bearing assertions here — the slice introduces NO new permission, NO
 * new table, NO new function. These are exactly the synth-time pins the local
 * stand-up CANNOT prove (IAM scoping, schema), per delta 011 §5.
 *
 *   - T-CHAT-1 (AC1.1): exactly SIX WS route keys, `chat` present, no $default.
 *   - T-CHAT-5 (AC1.2): oxo-ws-fn IAM policy is the s007 grant set VERBATIM —
 *     GetItem on Games + Connections, the s006 write set on Connections, the
 *     code-index Query, and execute-api:ManageConnections on THIS WS API ARN
 *     only. The `chat` route adds ZERO new action, no `*`, no new table grant.
 *   - T-CHAT-6 (AC1.9 infra arm): no new DynamoDB table is synthesised for chat
 *     (in-memory / no-persist — the table set is the pre-s014 set).
 */

function synth(): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new OxoGameStack(app, 'OxoGameProd', {
      env: { account: '123456789012', region: 'eu-west-2' },
    }),
  );
}

function wsRouteKeys(template: Template): string[] {
  const apis = template.findResources('AWS::ApiGatewayV2::Api', {
    Properties: { ProtocolType: 'WEBSOCKET' },
  });
  const wsApiLogicalId = Object.keys(apis)[0];
  const routes = template.findResources('AWS::ApiGatewayV2::Route');
  return Object.values(routes)
    .filter(
      (r) =>
        ((r.Properties as Record<string, unknown>).ApiId as { Ref?: string })
          ?.Ref === wsApiLogicalId,
    )
    .map((r) => (r.Properties as Record<string, unknown>).RouteKey as string);
}

function wsRoleStatements(template: Template): Array<Record<string, unknown>> {
  const roles = template.findResources('AWS::IAM::Role');
  const wsRoleId = Object.keys(roles).find((id) =>
    id.startsWith('WsFunctionRole'),
  );
  expect(wsRoleId).toBeDefined();
  const out: Array<Record<string, unknown>> = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const roleRefs = ((policy.Properties as Record<string, unknown>).Roles ??
      []) as Array<{ Ref?: string }>;
    if (!roleRefs.some((r) => r.Ref === wsRoleId)) continue;
    const stmts = (
      (policy.Properties as Record<string, unknown>).PolicyDocument as {
        Statement?: unknown[];
      }
    ).Statement as Array<Record<string, unknown>>;
    for (const s of stmts ?? []) out.push(s);
  }
  return out;
}

function actionList(stmt: Record<string, unknown>): string[] {
  const a = stmt.Action;
  return Array.isArray(a) ? (a as string[]) : [a as string];
}

describe('s014 chat — route surface (T-CHAT-1 / AC1.1)', () => {
  it('synthesises exactly SIX WS route keys including `chat`, with no $default', () => {
    const keys = wsRouteKeys(synth()).sort();
    expect(keys).toEqual([
      '$connect',
      '$disconnect',
      'chat',
      'join',
      'move',
      'register',
    ]);
    expect(keys).toHaveLength(6);
    expect(keys).toContain('chat');
    expect(keys).not.toContain('$default');
  });

  it('the `chat` route targets the SAME oxo-ws-fn integration (no new function)', () => {
    const template = synth();
    // Exactly ONE Lambda named oxo-ws-fn — chat reuses it, no new function.
    const wsFns = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'oxo-ws-fn' },
    });
    expect(Object.keys(wsFns)).toHaveLength(1);
    // There is exactly ONE WS integration (AWS_PROXY) shared by all routes.
    const apis = template.findResources('AWS::ApiGatewayV2::Api', {
      Properties: { ProtocolType: 'WEBSOCKET' },
    });
    const wsApiLogicalId = Object.keys(apis)[0];
    const integrations = template.findResources(
      'AWS::ApiGatewayV2::Integration',
    );
    const wsIntegrations = Object.values(integrations).filter(
      (i) =>
        ((i.Properties as Record<string, unknown>).ApiId as { Ref?: string })
          ?.Ref === wsApiLogicalId,
    );
    expect(wsIntegrations).toHaveLength(1);
  });
});

describe('s014 chat — no new IAM grant (T-CHAT-5 / AC1.2)', () => {
  it('the oxo-ws-fn DynamoDB action set is the s007 grant set verbatim — no new action, no *, no Scan', () => {
    const statements = wsRoleStatements(synth());
    const ddb = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('dynamodb:'),
      ),
    );
    const allDdbActions = [...new Set(ddb.flatMap(actionList))].slice().sort();
    // Byte-for-byte the s007 set — chat adds zero DynamoDB actions (it only
    // READS Games via the already-granted GetItem; no write of any kind).
    expect(allDdbActions).toEqual(
      [
        'dynamodb:DeleteItem',
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:Query',
        'dynamodb:UpdateItem',
      ].sort(),
    );
    expect(allDdbActions).not.toContain('dynamodb:Scan');
    expect(allDdbActions.includes('dynamodb:*')).toBe(false);
    for (const s of ddb) {
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      for (const r of resources) expect(r).not.toBe('*');
    }
  });

  it('the ONLY execute-api grant is ManageConnections scoped to THIS WS API @connections (the s005 relay grant — covers chat relay+echo)', () => {
    const statements = wsRoleStatements(synth());
    const execApi = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('execute-api:'),
      ),
    );
    // EXACTLY ONE execute-api statement — chat relay+echo are two more
    // PostToConnection calls on the SAME grant; no widening (OI-CHAT-1).
    expect(execApi).toHaveLength(1);
    expect(actionList(execApi[0])).toEqual(['execute-api:ManageConnections']);
    const resources = Array.isArray(execApi[0].Resource)
      ? execApi[0].Resource
      : [execApi[0].Resource];
    for (const r of resources) {
      expect(r).not.toBe('*');
      const json = JSON.stringify(r);
      expect(json).not.toContain('execute-api:*');
      expect(json).toContain('@connections');
    }
  });
});

describe('s014 chat — no new table (T-CHAT-6 infra arm / AC1.9)', () => {
  it('synthesises NO chat/messages table — the table set is the pre-s014 set (in-memory / no-persist)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table');
    const names = Object.values(tables)
      .map((t) => (t.Properties as Record<string, unknown>).TableName as string)
      .sort();
    // The exact pre-s014 table set: Games, Connections, Codes, Leaderboard,
    // connect-attempts. No chat/messages table is added (chat lives in React
    // component state only — delta 011 §1 "No new table. No Stream.").
    expect(names).toEqual([
      'oxo-codes',
      'oxo-connect-attempts',
      'oxo-connections',
      'oxo-games',
      'oxo-leaderboard',
    ]);
    expect(names.some((n) => /chat|message/i.test(n))).toBe(false);
  });
});
