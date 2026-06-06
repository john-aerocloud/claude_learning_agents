import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OxoGameStack, WS_RATE_LIMIT_PER_5MIN } from '../lib/game-stack';

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
// s005-h1-waf — UC2: regional WebACL on the WS prod stage (Steps 4 & 5).
// SYNTH-CONTRACT-WAF-3 (REGIONAL ACL + association) and
// SYNTH-CONTRACT-WAF-4 (negative: no association on the HTTP API stage).
// ===========================================================================

function webAcls(template: Template): Array<Record<string, unknown>> {
  return Object.values(template.findResources('AWS::WAFv2::WebACL')).map(
    (r) => r.Properties as Record<string, unknown>,
  );
}

function webAclAssociations(
  template: Template,
): Array<Record<string, unknown>> {
  return Object.values(
    template.findResources('AWS::WAFv2::WebACLAssociation'),
  ).map((r) => r.Properties as Record<string, unknown>);
}

describe('OxoGameStack — regional WebACL (SYNTH-CONTRACT-WAF-3, AC2.2/2.3, DEPLOY-IDENTITY-WAF)', () => {
  it('synthesises exactly one REGIONAL WebACL with default action Allow', () => {
    const template = synth();
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
    const acl = webAcls(template)[0];
    expect(acl.Scope).toBe('REGIONAL');
    // DefaultAction must be Allow (default-allow, transparent to legit traffic).
    expect(acl.DefaultAction).toBeDefined();
    expect(Object.keys(acl.DefaultAction as Record<string, unknown>)).toEqual([
      'Allow',
    ]);
  });

  it('rate-based rule Limit <= 20 and equals the WS_RATE_LIMIT_PER_5MIN constant (not a hardcoded literal)', () => {
    expect(WS_RATE_LIMIT_PER_5MIN).toBeLessThanOrEqual(20);
    const acl = webAcls(synth())[0];
    const rules = acl.Rules as Array<Record<string, unknown>>;
    const rateRule = rules.find(
      (r) =>
        (r.Statement as Record<string, unknown>)?.RateBasedStatement !==
        undefined,
    );
    expect(rateRule).toBeDefined();
    const rbs = (rateRule!.Statement as Record<string, unknown>)
      .RateBasedStatement as Record<string, unknown>;
    expect(rbs.AggregateKeyType).toBe('IP');
    expect(rbs.Limit).toBe(WS_RATE_LIMIT_PER_5MIN);
    expect(rbs.Limit as number).toBeLessThanOrEqual(20);
  });

  it('includes the AWSManagedRulesAmazonIpReputationList managed rule group', () => {
    const acl = webAcls(synth())[0];
    const rules = acl.Rules as Array<Record<string, unknown>>;
    const ipRep = rules.find((r) => {
      const stmt = r.Statement as Record<string, unknown>;
      const mrg = stmt?.ManagedRuleGroupStatement as
        | Record<string, unknown>
        | undefined;
      return mrg?.Name === 'AWSManagedRulesAmazonIpReputationList';
    });
    expect(ipRep).toBeDefined();
    const mrg = (ipRep!.Statement as Record<string, unknown>)
      .ManagedRuleGroupStatement as Record<string, unknown>;
    expect(mrg.VendorName).toBe('AWS');
  });

  it('enables CloudWatch metrics + sampled requests visibility on the ACL default and every rule', () => {
    const acl = webAcls(synth())[0];
    const vis = acl.VisibilityConfig as Record<string, unknown>;
    expect(vis.CloudWatchMetricsEnabled).toBe(true);
    expect(vis.SampledRequestsEnabled).toBe(true);
    const rules = acl.Rules as Array<Record<string, unknown>>;
    for (const r of rules) {
      const rv = r.VisibilityConfig as Record<string, unknown>;
      expect(rv.CloudWatchMetricsEnabled).toBe(true);
      expect(rv.SampledRequestsEnabled).toBe(true);
    }
  });

  it('carries Project/Env/ManagedBy=cdk tags (DEPLOY-IDENTITY-WAF)', () => {
    const acl = webAcls(synth())[0];
    const tags = (acl.Tags as Array<{ Key: string; Value: string }>) ?? [];
    const tagMap = Object.fromEntries(tags.map((t) => [t.Key, t.Value]));
    expect(tagMap.Project).toBe('oxo-online');
    expect(tagMap.Env).toBe('prod');
    expect(tagMap.ManagedBy).toBe('cdk');
  });
});

describe('OxoGameStack — WebACL association to WS prod stage (SYNTH-CONTRACT-WAF-3/4, AC2.1)', () => {
  it('creates exactly one WebACLAssociation whose ResourceArn derives from the WS API id + prod stage (not a hardcoded literal ARN)', () => {
    const template = synth();
    template.resourceCountIs('AWS::WAFv2::WebACLAssociation', 1);
    const assoc = webAclAssociations(template)[0];
    const resourceArn = assoc.ResourceArn;
    // Derived, not a plain literal string ARN — must be a CFN intrinsic
    // (Fn::Sub / Fn::Join referencing the WS API + stage Refs).
    expect(typeof resourceArn).not.toBe('string');
    const json = JSON.stringify(resourceArn);
    // References the WS API logical id and the prod stage (derived).
    expect(json).toContain('prod');
    // Targets an apigateway WS stage ARN shape.
    expect(json).toContain('apigateway');
    expect(json).toContain('/stages/');
    // The WebACLArn must reference the regional WebACL (GetAtt on its Arn).
    expect(JSON.stringify(assoc.WebACLArn)).toContain('Arn');
  });

  it('SYNTH-CONTRACT-WAF-4: no WebACLAssociation targets the HTTP API id / HTTP stage', () => {
    const template = synth();
    // Resolve the HTTP API and WS API logical ids to distinguish them.
    const httpApis = template.findResources('AWS::ApiGatewayV2::Api', {
      Properties: { ProtocolType: Match.absent() },
    });
    // HTTP API (oxo-game-api) has no ProtocolType WEBSOCKET; find by name.
    const allApis = template.findResources('AWS::ApiGatewayV2::Api');
    const httpApiLogicalId = Object.keys(allApis).find(
      (id) =>
        (allApis[id].Properties as Record<string, unknown>).Name ===
        'oxo-game-api',
    );
    expect(httpApiLogicalId).toBeDefined();
    // The HTTP API ($default) stage logical ids.
    const httpStages = template.findResources('AWS::ApiGatewayV2::Stage', {
      Properties: { StageName: '$default' },
    });
    const associations = webAclAssociations(template);
    for (const assoc of associations) {
      const json = JSON.stringify(assoc.ResourceArn);
      // Must NOT reference the HTTP API logical id.
      expect(json).not.toContain(httpApiLogicalId!);
      // Must NOT reference any HTTP ($default) stage logical id.
      for (const stageId of Object.keys(httpStages)) {
        expect(json).not.toContain(stageId);
      }
      // And must NOT reference the $default stage name.
      expect(json).not.toContain('$default');
    }
    void httpApis;
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
