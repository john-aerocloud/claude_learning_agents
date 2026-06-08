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

describe('OxoGameStack — DynamoDB tables exist (Step 4 harness; s005 adds Connections, s005-h2 adds ConnectAttempts, s005-h3 adds Codes)', () => {
  it('synthesises exactly five DynamoDB tables (Games + Connections + ConnectAttempts + Codes + Leaderboard — s009)', () => {
    const template = synth();
    template.resourceCountIs('AWS::DynamoDB::Table', 5);
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
      Handler: 'games/handler.handler', // re-nested by token/ shared module (A1 5b19d90)
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

  it('grants PutItem on Games/Codes + Scan on Leaderboard only — no wildcard, no other action (T3, s009 AC3.7)', () => {
    // s009 (delta 010): game-fn legitimately gains dynamodb:Scan on the
    // Leaderboard ARN (the GET /api/leaderboard read). The previous "every DDB
    // grant is exactly PutItem" pin is superseded: each DDB statement is now
    // EITHER PutItem (Games/Codes) OR Scan (Leaderboard) — never a wildcard, never
    // a read/scan/delete on Games/Codes. The tight Leaderboard bound (Scan only)
    // is pinned in game-stack-s009.test.ts.
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
      const resJson = JSON.stringify(stmt.Resource);
      if (resJson.includes('Leaderboard')) {
        // The ONLY action on the Leaderboard ARN is Scan.
        expect(actions).toEqual(['dynamodb:Scan']);
      } else {
        // Games / Codes — still strictly PutItem.
        expect(actions).toEqual(['dynamodb:PutItem']);
      }
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

  it('declares exactly the six route keys $connect/$disconnect/register/join/move/chat and no $default (s014)', () => {
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
    expect(wsRouteKeys).toEqual(['$connect', '$disconnect', 'chat', 'join', 'move', 'register']);
    expect(wsRouteKeys).not.toContain('$default');
  });

  it("oxo-ws-fn handler entry is 'ws/handler.handler' (re-nested bundle — handler-path incident class)", () => {
    const template = synth();
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'oxo-ws-fn' },
    });
    const fn = Object.values(fns)[0];
    // The s006 ws-fn deploy bundle (tsconfig.ws.json, rootDir=lambda root) nests
    // the handler at ws/dist/ws/handler.js so the move/ domain compiles alongside
    // it — so the CDK handler entry MUST be 'ws/handler.handler' (build-coverage
    // test pins the emitted path; this pins the coupled CDK string).
    expect(fn.Properties.Handler).toBe('ws/handler.handler');
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
    // Unique action set (s007 UC2-S1: GetItem now appears on TWO ARNs — Games
    // and the new Connections read — so the flattened list has a duplicate; the
    // PIN is the distinct action set, which is byte-for-byte the s006 set,
    // AC2.2 negative arm "nothing else widened").
    const allDdbActions = [...new Set(ddb.flatMap(actionList))].slice().sort();
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

  it('S5 (s007 AC2.1 positive arm): dynamodb:GetItem is granted on the Connections table ARN (the ONE new grant)', () => {
    // s007 UC2-S1: the $disconnect handler resolves connectionId -> gameId via
    // GetItem(Connections, connectionId). This is the EXACTLY-ONE-assertion change
    // from the s006 ws-fn pin (delta §3, AC2.1). The aggregate action-set test
    // (S1 above) is unchanged because GetItem already appears (on Games); this
    // arm pins that GetItem is ALSO scoped to the Connections ARN — the new read.
    const statements = wsRoleStatements(synth());
    const ddb = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('dynamodb:'),
      ),
    );
    const connectionsGetItem = ddb.find(
      (s) =>
        actionList(s).includes('dynamodb:GetItem') &&
        JSON.stringify(s.Resource).includes('ConnectionsTable'),
    );
    expect(
      connectionsGetItem,
      'expected a dynamodb:GetItem grant scoped to the Connections table ARN (AC2.1)',
    ).toBeDefined();
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

  it('S2/Bug B: the ManageConnections resource permits DELETE (not pinned to POST only)', () => {
    // DEFECT-005-001 Bug B: the close transport DELETEs the connection (the only
    // close primitive @connections offers) in addition to POSTing the error
    // frame. The IAM resource must therefore not be pinned to the POST verb
    // segment only, or the DeleteConnection call is denied. Still scoped to this
    // API + prod stage + @connections (S2 unchanged).
    const statements = wsRoleStatements(synth());
    const execApi = statements.filter((s) =>
      actionList(s).some(
        (a) => typeof a === 'string' && a.startsWith('execute-api:'),
      ),
    );
    const resources = Array.isArray(execApi[0].Resource)
      ? execApi[0].Resource
      : [execApi[0].Resource];
    for (const r of resources) {
      const json = JSON.stringify(r);
      // The verb segment before @connections must not restrict to POST only.
      expect(json).not.toContain('/POST/@connections');
      // Still scoped to the prod stage.
      expect(json).toContain('/prod/');
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

// ===========================================================================
// s005-h1-waf — UC2 DESCOPE (GATE-AMEND-H1-A, human-approved Option A).
//
// PLATFORM-HONESTY REGRESSION (negative pin).
// The original UC2 added a REGIONAL WAFv2 WebACL + a CfnWebACLAssociation
// targeting the WebSocket (API Gateway v2) `prod` stage. That deploy FAILED at
// OxoGameProd CREATE: WAFv2 rejects the WS-v2 stage ARN as an unsupported
// resource type —
//   "The ARN isn't valid ... arn:aws:apigateway:eu-west-2::/apis/<id>/stages/prod"
//   (Service: Wafv2, Status 400, RESOURCE_ARN). Run 27066828546.
// WAFv2 CfnWebACLAssociation supports ALB / API GW v1 (REST) / AppSync /
// Cognito / App Runner / Verified Access — NOT API GW v2 (HTTP or WebSocket).
// There is therefore no way to put a WAFv2 ACL in front of the WS stage.
//
// Per GATE-AMEND-H1-A the WS regional WAF is dropped; the in-slice abuse floor
// for the WS transport remains the prod-stage default-route throttle
// (ThrottlingRateLimit/BurstLimit, asserted above). The HTTP half of the slice
// (CloudFront global ACL on /api/*) is unaffected and still ships.
//
// These assertions PIN that OxoGameProd synthesises NO WAFv2 resources at all,
// so the unsupported association cannot silently return.
// ===========================================================================
describe('OxoGameStack — UC2 descope: NO WAFv2 on this stack (GATE-AMEND-H1-A platform-honesty pin)', () => {
  it('synthesises no AWS::WAFv2::WebACL (WAFv2 cannot front an API GW v2 stage)', () => {
    const template = synth();
    template.resourceCountIs('AWS::WAFv2::WebACL', 0);
  });

  it('synthesises no AWS::WAFv2::WebACLAssociation (the WS-v2 stage ARN is an unsupported WAFv2 resource type — run 27066828546)', () => {
    const template = synth();
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 0);
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

// ===========================================================================
// s005-h3 — Codes reservation table + scoped PutItem grant (delta 009, OI-3).
// AC-5 IAM PIN (no widening), table shape, AC for Codes is a write-time gate.
// ===========================================================================

/** All DynamoDB IAM statements attached to the oxo-game-fn execution role. */
function gameFnDdbStatements(template: Template): Array<Record<string, unknown>> {
  const roles = template.findResources('AWS::IAM::Role');
  const gameRoleId = Object.keys(roles).find((id) =>
    id.startsWith('GameFunctionServiceRole'),
  );
  expect(gameRoleId).toBeDefined();
  const out: Array<Record<string, unknown>> = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const roleRefs = ((policy.Properties as Record<string, unknown>).Roles ??
      []) as Array<{ Ref?: string }>;
    if (!roleRefs.some((r) => r.Ref === gameRoleId)) continue;
    const stmts = (
      (policy.Properties as Record<string, unknown>).PolicyDocument as {
        Statement?: unknown[];
      }
    ).Statement as Array<Record<string, unknown>>;
    for (const s of stmts ?? []) {
      const actions = actionList(s);
      if (actions.some((a) => typeof a === 'string' && a.startsWith('dynamodb:'))) {
        out.push(s);
      }
    }
  }
  return out;
}

/** Find the Codes table logical id (named oxo-codes). */
function codesTableId(template: Template): string {
  const tables = template.findResources('AWS::DynamoDB::Table', {
    Properties: { TableName: 'oxo-codes' },
  });
  const id = Object.keys(tables)[0];
  expect(id).toBeDefined();
  return id;
}

describe('OxoGameStack — Codes reservation table shape (delta 009)', () => {
  it('uses code as the HASH key, no sort key', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-codes',
      KeySchema: [{ AttributeName: 'code', KeyType: 'HASH' }],
    });
  });

  it('enables TTL on the ttl attribute (orphan reservations self-delete)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-codes',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('enables server-side encryption at rest (SSE)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-codes',
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('uses on-demand (pay-per-request) billing', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-codes',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('declares NO GSI on the Codes table (write-time gate only; never on a read path)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-codes' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    expect(props.GlobalSecondaryIndexes).toBeUndefined();
  });

  it('declares no public resource policy on the Codes table', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-codes' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    expect(props.ResourcePolicy).toBeUndefined();
  });
});

describe('OxoGameStack — AC-5 IAM PIN: oxo-game-fn gains EXACTLY PutItem on Codes ARN', () => {
  it('grants dynamodb:PutItem scoped to the Codes table ARN (a statement targeting Codes)', () => {
    const template = synth();
    const codesId = codesTableId(template);
    const stmts = gameFnDdbStatements(template);
    const codesStmt = stmts.find((s) =>
      JSON.stringify(s.Resource).includes(codesId),
    );
    expect(codesStmt, 'a DDB statement on the game-fn role must target the Codes table').toBeDefined();
    // EXACTLY PutItem — nothing else on Codes.
    expect(actionList(codesStmt as Record<string, unknown>)).toEqual(['dynamodb:PutItem']);
  });

  it('grants NO DeleteItem / GetItem / Query / Scan / UpdateItem on the Codes table (negatives)', () => {
    const template = synth();
    const codesId = codesTableId(template);
    const forbidden = [
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
      'dynamodb:BatchGetItem',
      'dynamodb:BatchWriteItem',
    ];
    const stmts = gameFnDdbStatements(template);
    for (const s of stmts) {
      const resJson = JSON.stringify(s.Resource);
      if (!resJson.includes(codesId)) continue;
      for (const action of actionList(s)) {
        expect(forbidden).not.toContain(action);
        expect(action).not.toBe('dynamodb:*');
      }
    }
  });

  it('every game-fn DDB grant is PutItem (Games+Codes) or Scan (Leaderboard), no wildcard resource', () => {
    // s009 (delta 010): the aggregate role DDB action-set is PutItem (Games),
    // PutItem (Codes), and Scan (Leaderboard) — the only s009 widening (AC3.7).
    // The s005-h2 SSM secret read is not a DDB action. No read/delete on
    // Games/Codes; no UpdateItem/Query/Get on Leaderboard; no wildcard resource.
    const template = synth();
    const stmts = gameFnDdbStatements(template);
    expect(stmts.length).toBeGreaterThanOrEqual(3);
    for (const s of stmts) {
      const resJson = JSON.stringify(s.Resource);
      if (resJson.includes('Leaderboard')) {
        expect(actionList(s)).toEqual(['dynamodb:Scan']);
      } else {
        expect(actionList(s)).toEqual(['dynamodb:PutItem']);
      }
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      for (const r of resources) {
        expect(r).not.toBe('*');
        expect(JSON.stringify(r)).not.toContain('dynamodb:*');
      }
    }
  });

  it('no Codes GSI ARN appears in any game-fn grant', () => {
    const template = synth();
    const stmts = gameFnDdbStatements(template);
    for (const s of stmts) {
      const resJson = JSON.stringify(s.Resource);
      if (resJson.includes('oxo-codes') || resJson.includes(codesTableId(template))) {
        expect(resJson).not.toContain('index/');
      }
    }
  });
});

describe('OxoGameStack — oxo-game-fn carries CODES_TABLE + BUILD_SHA env (delta 009)', () => {
  it('passes the Codes table name via CODES_TABLE', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-game-fn',
      Environment: { Variables: { CODES_TABLE: Match.anyValue() } },
    });
  });

  it('passes BUILD_SHA so the exhausted-retry 5xx log carries build identity (principles/01)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-game-fn',
      Environment: { Variables: { BUILD_SHA: Match.anyValue() } },
    });
  });
});
