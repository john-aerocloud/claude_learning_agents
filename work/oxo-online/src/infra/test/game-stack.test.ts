import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';

function synthStack(): OxoGameStack {
  const app = new cdk.App();
  return new OxoGameStack(app, 'OxoGameProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
}

function synth(): Template {
  return Template.fromStack(synthStack());
}

describe('OxoGameStack — DynamoDB tables exist (Step 4 harness; s005 adds Connections)', () => {
  it('synthesises exactly two DynamoDB tables (Games + Connections)', () => {
    const template = synth();
    template.resourceCountIs('AWS::DynamoDB::Table', 2);
  });
});

describe('OxoGameStack — Games table shape (T1, S3)', () => {
  it('uses gameId as the HASH key', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    });
  });

  it('enables TTL on the ttl attribute', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('enables server-side encryption at rest (SSE)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('uses on-demand (pay-per-request) billing', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('declares no public resource policy on any table (S3)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables)) {
      const policy = (table.Properties as Record<string, unknown>)
        ?.ResourcePolicy;
      expect(policy).toBeUndefined();
    }
  });
});

describe('OxoGameStack — Lambda oxo-game-fn (T3, T5, S3)', () => {
  it('runs on nodejs20.x with a fixed function name', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-game-fn',
      Runtime: 'nodejs20.x',
      Handler: 'handler.handler',
    });
  });

  it('passes the table name via the TABLE_NAME environment variable', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-game-fn',
      Environment: { Variables: { TABLE_NAME: Match.anyValue() } },
    });
  });

  it('caps reserved concurrency above zero (T5)', () => {
    const template = synth();
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'oxo-game-fn' },
    });
    const fn = Object.values(fns)[0];
    expect(fn.Properties.ReservedConcurrentExecutions).toBeGreaterThan(0);
  });

  it('grants only dynamodb:PutItem on the Games table ARN — no wildcard, no read/scan (T3)', () => {
    const template = synth();
    const roles = template.findResources('AWS::IAM::Role');
    const gameRoleId = Object.keys(roles).find((id) =>
      id.startsWith('GameFunctionServiceRole'),
    );
    expect(gameRoleId).toBeDefined();
    const policies = template.findResources('AWS::IAM::Policy');
    const ddbStatements: Array<Record<string, unknown>> = [];
    for (const policy of Object.values(policies)) {
      const roleRefs = ((policy.Properties as Record<string, unknown>).Roles ??
        []) as Array<{ Ref?: string }>;
      if (!roleRefs.some((r) => r.Ref === gameRoleId)) continue;
      const stmts = (policy.Properties.PolicyDocument.Statement ??
        []) as Array<Record<string, unknown>>;
      for (const stmt of stmts) {
        const action = stmt.Action;
        const actions = Array.isArray(action) ? action : [action];
        if (actions.some((a) => typeof a === 'string' && a.startsWith('dynamodb:'))) {
          ddbStatements.push(stmt);
        }
      }
    }
    expect(ddbStatements.length).toBeGreaterThan(0);
    for (const stmt of ddbStatements) {
      const action = stmt.Action;
      const actions = Array.isArray(action) ? action : [action];
      expect(actions).toEqual(['dynamodb:PutItem']);
      expect(stmt.Resource).not.toBe('*');
      const resources = Array.isArray(stmt.Resource)
        ? stmt.Resource
        : [stmt.Resource];
      for (const r of resources) {
        expect(r).not.toBe('*');
      }
    }
  });
});

// ===========================================================================
// s005 — WebSocket join-game surface (A0.1-A0.5)
// ===========================================================================

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

describe('OxoGameStack — Connections table (T9)', () => {
  it('keys on connectionId (HASH) with no sort key, SSE on, TTL on ttl, on-demand', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-connections',
      KeySchema: [{ AttributeName: 'connectionId', KeyType: 'HASH' }],
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('declares no resource policy on the Connections table (T9)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-connections' },
    });
    for (const table of Object.values(tables)) {
      const policy = (table.Properties as Record<string, unknown>)
        .ResourcePolicy;
      expect(policy).toBeUndefined();
    }
  });
});

describe('OxoGameStack — Games.code-index GSI; base schema unchanged (T10, S5)', () => {
  it('adds a code-index GSI keyed on code (HASH) with a minimal projection', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-games' },
    });
    const games = Object.values(tables)[0];
    const gsis = (games.Properties as Record<string, unknown>)
      .GlobalSecondaryIndexes as Array<Record<string, unknown>>;
    expect(Array.isArray(gsis)).toBe(true);
    const codeIndex = gsis.find((g) => g.IndexName === 'code-index');
    expect(codeIndex).toBeDefined();
    expect(codeIndex!.KeySchema).toEqual([
      { AttributeName: 'code', KeyType: 'HASH' },
    ]);
    const projection = codeIndex!.Projection as Record<string, unknown>;
    expect(projection.ProjectionType).toBe('INCLUDE');
    const nonKey = (projection.NonKeyAttributes as string[]).slice().sort();
    expect(nonKey).toEqual(
      ['guestConnectionId', 'hostConnectionId', 'status'].sort(),
    );
  });

  it('leaves the Games base-table KeySchema exactly [gameId HASH] (no replacement, S5)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    });
  });
});

describe('OxoGameStack — WebSocket API: four route keys, no $default, prod stage throttling (T7, T8)', () => {
  it('synthesises a WEBSOCKET API with the $request.body.action selector', () => {
    const template = synth();
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      ProtocolType: 'WEBSOCKET',
      RouteSelectionExpression: '$request.body.action',
    });
  });

  it('declares exactly the four route keys $connect/$disconnect/register/join and no $default', () => {
    const template = synth();
    const apis = template.findResources('AWS::ApiGatewayV2::Api', {
      Properties: { ProtocolType: 'WEBSOCKET' },
    });
    const wsApiLogicalId = Object.keys(apis)[0];
    expect(wsApiLogicalId).toBeDefined();
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const wsRouteKeys = Object.values(routes)
      .filter(
        (r) =>
          ((r.Properties as Record<string, unknown>).ApiId as { Ref?: string })
            ?.Ref === wsApiLogicalId,
      )
      .map((r) => (r.Properties as Record<string, unknown>).RouteKey as string)
      .sort();
    expect(wsRouteKeys).toEqual(['$connect', '$disconnect', 'join', 'register']);
    expect(wsRouteKeys).not.toContain('$default');
  });

  it('configures the prod stage with finite default-route throttling (T8)', () => {
    const template = synth();
    const stages = template.findResources('AWS::ApiGatewayV2::Stage', {
      Properties: { StageName: 'prod' },
    });
    const stage = Object.values(stages)[0];
    expect(stage).toBeDefined();
    const drs = (stage.Properties as Record<string, unknown>)
      .DefaultRouteSettings as Record<string, unknown>;
    expect(drs).toBeDefined();
    expect(typeof drs.ThrottlingRateLimit).toBe('number');
    expect(drs.ThrottlingRateLimit as number).toBeGreaterThan(0);
    expect(typeof drs.ThrottlingBurstLimit).toBe('number');
    expect(drs.ThrottlingBurstLimit as number).toBeGreaterThan(0);
  });

  it('auto-deploys the prod stage', () => {
    const template = synth();
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: 'prod',
      AutoDeploy: true,
    });
  });
});

describe('OxoGameStack — oxo-ws-fn Lambda + least-privilege role (T8, S1, S2)', () => {
  it('runs nodejs20.x with fixed name and finite reserved concurrency > 0 (T8)', () => {
    const template = synth();
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'oxo-ws-fn' },
    });
    const fn = Object.values(fns)[0];
    expect(fn).toBeDefined();
    expect(fn.Properties.Runtime).toBe('nodejs20.x');
    expect(typeof fn.Properties.ReservedConcurrentExecutions).toBe('number');
    expect(
      fn.Properties.ReservedConcurrentExecutions as number,
    ).toBeGreaterThan(0);
  });

  it('S1: DynamoDB actions are exactly Query/GetItem/UpdateItem/PutItem/DeleteItem — no Scan, no dynamodb:*, no bare-* resource', () => {
    const statements = wsRoleStatements(synth());
    const ddb = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('dynamodb:'),
      ),
    );
    const allDdbActions = ddb.flatMap(actionList).slice().sort();
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
    const readStmt = ddb.find((s) => actionList(s).includes('dynamodb:Query'))!;
    expect(JSON.stringify(readStmt.Resource)).toContain('index/code-index');
  });

  it('S1: PutItem/DeleteItem belong to the Connections statement only — Games carries no write grant', () => {
    const statements = wsRoleStatements(synth());
    const ddb = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('dynamodb:'),
      ),
    );
    const writeStmt = ddb.find((s) =>
      actionList(s).includes('dynamodb:DeleteItem'),
    )!;
    expect(actionList(writeStmt).slice().sort()).toEqual([
      'dynamodb:DeleteItem',
      'dynamodb:PutItem',
    ]);
    expect(JSON.stringify(writeStmt.Resource)).toContain('ConnectionsTable');
    const updateStmt = ddb.find((s) =>
      actionList(s).includes('dynamodb:UpdateItem'),
    )!;
    expect(actionList(updateStmt)).toEqual(['dynamodb:UpdateItem']);
  });

  it('S2: the only execute-api statement is ManageConnections scoped to this WS API id, not *', () => {
    const statements = wsRoleStatements(synth());
    const execApi = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('execute-api:'),
      ),
    );
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

describe('OxoGameStack — WS cross-stack outputs additive; s004 HttpApiEndpoint untouched (T7, S5)', () => {
  it('exports OxoGameProd-WsApiEndpoint resolving to id + /prod', () => {
    const template = synth();
    template.hasOutput('WsApiEndpoint', {
      Export: { Name: 'OxoGameProd-WsApiEndpoint' },
    });
    const outputs = template.findOutputs('WsApiEndpoint');
    const value = JSON.stringify(Object.values(outputs)[0].Value);
    expect(value).toContain('wss://');
    expect(value).toContain('/prod');
  });

  it('exports OxoGameProd-WsApiId', () => {
    const template = synth();
    template.hasOutput('WsApiId', {
      Export: { Name: 'OxoGameProd-WsApiId' },
    });
  });

  it('leaves the s004 OxoGameProd-HttpApiEndpoint export present and unchanged (S5)', () => {
    const template = synth();
    template.hasOutput('HttpApiEndpoint', {
      Export: { Name: 'OxoGameProd-HttpApiEndpoint' },
    });
  });
});

describe('OxoGameStack — HTTP API POST /games + cross-stack outputs (Step 7)', () => {
  it('exposes a POST /api/games route (DEFECT-004-001: matches the CloudFront /api/* path forwarded to the origin)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/games',
    });
  });

  it('integrates the route with a Lambda proxy (AWS_PROXY)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::ApiGatewayV2::Integration', {
      IntegrationType: 'AWS_PROXY',
    });
  });

  it('exports HttpApiEndpoint with the stable exportName', () => {
    const template = synth();
    template.hasOutput('HttpApiEndpoint', {
      Export: { Name: 'OxoGameProd-HttpApiEndpoint' },
    });
  });

  it('exports LambdaFunctionName with the stable exportName', () => {
    const template = synth();
    template.hasOutput('LambdaFunctionName', {
      Export: { Name: 'OxoGameProd-LambdaFunctionName' },
    });
  });
});
