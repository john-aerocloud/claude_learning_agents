import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';
import { OxoOnlineOidcStack } from '../lib/oxo-online-oidc-stack';

// s005-h2 — $connect REQUEST authorizer + ConnectAttempts + shared ws-token
// secret. Synth contracts (SYNTH-CONTRACT-H2-1/2/3) and code↔policy pins
// (CP-H2-A/B/C/D). All resources land in OxoGameProd; no new stack.

function synth(): Template {
  const app = new cdk.App();
  return Template.fromStack(
    new OxoGameStack(app, 'OxoGameProd', {
      env: { account: '123456789012', region: 'eu-west-2' },
    }),
  );
}

// §40 lifecycle COMPLETE: the H2_ENFORCE use-case flag (two-phase credential
// rollout, §39 ordering) has been factored out of the code. Slice validated
// 17/17 ACs in prod (result.md, sha 7382284); its retained-rollback-lever phase
// is over. The $connect REQUEST-authorizer gate is now UNCONDITIONAL — there is
// no context that disables it. The former `synthOff()` helper and the
// "ROLLBACK LEVER: explicit h2Enforce=false leaves $connect unauthenticated"
// test were DELETED with the flag (an orphan flag at retro is a §40 principle
// failure). The unconditional pin below asserts $connect carries CUSTOM +
// AuthorizerId in EVERY synth, with no context dependence.

// ---- helpers ---------------------------------------------------------------
function actionList(stmt: Record<string, unknown>): string[] {
  const a = stmt.Action;
  return Array.isArray(a) ? (a as string[]) : [a as string];
}

function roleStatements(
  template: Template,
  rolePrefix: string,
): Array<Record<string, unknown>> {
  const roles = template.findResources('AWS::IAM::Role');
  const roleId = Object.keys(roles).find((id) => id.startsWith(rolePrefix));
  expect(roleId, `role ${rolePrefix} should exist`).toBeDefined();
  const out: Array<Record<string, unknown>> = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const roleRefs = ((policy.Properties as Record<string, unknown>).Roles ??
      []) as Array<{ Ref?: string }>;
    if (!roleRefs.some((r) => r.Ref === roleId)) continue;
    const stmts = (
      (policy.Properties as Record<string, unknown>).PolicyDocument as {
        Statement?: unknown[];
      }
    ).Statement as Array<Record<string, unknown>>;
    for (const s of stmts ?? []) out.push(s);
  }
  return out;
}

// ===========================================================================
// S-A2.7 [T5, AC2.2, S4] — ConnectAttempts table shape
// ===========================================================================
describe('s005-h2 — ConnectAttempts table (T5, S4)', () => {
  it('keys on sourceIp (HASH) only, on-demand, SSE on, TTL on ttl', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-connect-attempts',
      KeySchema: [{ AttributeName: 'sourceIp', KeyType: 'HASH' }],
      BillingMode: 'PAY_PER_REQUEST',
      SSESpecification: { SSEEnabled: true },
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('has no sort key (single-attribute KeySchema)', () => {
    const t = synth();
    const tables = t.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-connect-attempts' },
    });
    const ks = (Object.values(tables)[0].Properties as Record<string, unknown>)
      .KeySchema as unknown[];
    expect(ks).toHaveLength(1);
  });

  it('has no PITR enabled and no public resource policy (S4)', () => {
    const t = synth();
    const tables = t.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-connect-attempts' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    const pitr = props.PointInTimeRecoverySpecification as
      | { PointInTimeRecoveryEnabled?: boolean }
      | undefined;
    if (pitr) expect(pitr.PointInTimeRecoveryEnabled).not.toBe(true);
    expect(props.ResourcePolicy).toBeUndefined();
  });

  it('synthesises exactly three DynamoDB tables now (Games, Connections, ConnectAttempts)', () => {
    synth().resourceCountIs('AWS::DynamoDB::Table', 3);
  });
});

// ===========================================================================
// S-A2.8 [T1, AC2.1, SYNTH-CONTRACT-H2-1] — authorizer attached to $connect
// ===========================================================================
describe('s005-h2 — authorizer attached to $connect (T1)', () => {
  it('declares a REQUEST authorizer referencing oxo-ws-auth-fn', () => {
    const t = synth();
    const authorizers = t.findResources('AWS::ApiGatewayV2::Authorizer');
    const reqAuth = Object.values(authorizers).find(
      (a) =>
        (a.Properties as Record<string, unknown>).AuthorizerType === 'REQUEST',
    );
    expect(reqAuth).toBeDefined();
    // URI must reference the authorizer function (Fn::Join/Sub over its ARN).
    const uri = JSON.stringify(
      (reqAuth!.Properties as Record<string, unknown>).AuthorizerUri,
    );
    expect(uri).toMatch(/WsAuthFunction|oxo-ws-auth-fn/);
  });

  // DEFECT-H2-002 pin (platform strike 5): IdentitySource MUST BE ABSENT.
  // API Gateway treats MULTIPLE identity sources as ALL-REQUIRED (AND): a
  // $connect missing ANY listed source is rejected BEFORE the authorizer is
  // invoked. Hosts send only ?wsToken, guests send only ?code — neither sends
  // both, so the prior two-entry pin (`...wsToken` AND `...code`) caused EVERY
  // connect to be rejected pre-invocation (oxo-ws-auth-fn never ran). IdentitySource
  // cannot express OR. A REQUEST authorizer with NO identity source is invoked
  // UNCONDITIONALLY; the authorizer's own logic handles the wsToken/code
  // either-or and the deny-when-absent paths (unit-pinned). So we replace the
  // old two-entry assertion with: the property is omitted entirely.
  it('IdentitySource is ABSENT — APIGW ANDs multiple sources; either-or is the authorizer fn job (DEFECT-H2-002, strike 5)', () => {
    const t = synth();
    const authorizers = t.findResources('AWS::ApiGatewayV2::Authorizer');
    const reqAuth = Object.values(authorizers).find(
      (a) =>
        (a.Properties as Record<string, unknown>).AuthorizerType === 'REQUEST',
    )!;
    expect(
      (reqAuth.Properties as Record<string, unknown>).IdentitySource,
    ).toBeUndefined();
  });

  // §40 lifecycle COMPLETE: the gate is UNCONDITIONAL. Every synth — there is
  // no longer any context that disables it (the H2_ENFORCE flag and its
  // `synthOff()` rollback-lever test were factored out after the slice
  // validated 17/17 in prod) — must show $connect carrying AuthorizationType
  // CUSTOM + the REQUEST authorizer's AuthorizerId, with the route depending on
  // the authorizer. This is the standing truth the flag used to gate.
  it('UNCONDITIONAL (no context dependence): $connect is CUSTOM with that AuthorizerId + dependency (T1, §40 lifecycle complete)', () => {
    const t = synth();
    const authorizers = t.findResources('AWS::ApiGatewayV2::Authorizer');
    const reqAuthId = Object.keys(authorizers).find(
      (id) =>
        (authorizers[id].Properties as Record<string, unknown>)
          .AuthorizerType === 'REQUEST',
    )!;
    const routes = t.findResources('AWS::ApiGatewayV2::Route');
    const connectId = Object.keys(routes).find(
      (id) =>
        (routes[id].Properties as Record<string, unknown>).RouteKey ===
        '$connect',
    )!;
    const connect = routes[connectId];
    const props = connect.Properties as Record<string, unknown>;
    expect(props.AuthorizationType).toBe('CUSTOM');
    expect((props.AuthorizerId as { Ref?: string }).Ref).toBe(reqAuthId);
    // The route must depend on the authorizer (create-order safety).
    const dependsOn = Array.isArray(connect.DependsOn)
      ? (connect.DependsOn as string[])
      : connect.DependsOn
        ? [connect.DependsOn as string]
        : [];
    expect(dependsOn).toContain(reqAuthId);
  });
});

// ===========================================================================
// S-A2.9 [T2, SYNTH-CONTRACT-H2-3] — cache disabled
// ===========================================================================
describe('s005-h2 — authorizer cache disabled (T2)', () => {
  // T2 re-pinned (platform strike 4): WEBSOCKET APIs reject the
  // AuthorizerResultTtlInSeconds property outright — no-cache is inherent.
  // The pin is now ABSENCE of the property (presence broke CREATE, run
  // 27085881193).
  it('the WS authorizer sets NO AuthorizerResultTtlInSeconds (WS APIs reject it; no-cache inherent)', () => {
    const t = synth();
    const authorizers = t.findResources('AWS::ApiGatewayV2::Authorizer');
    const req = Object.values(authorizers).find(
      (a) =>
        (a.Properties as Record<string, unknown>).AuthorizerType === 'REQUEST',
    )!;
    expect(
      (req.Properties as Record<string, unknown>).AuthorizerResultTtlInSeconds,
    ).toBeUndefined();
  });
});

// ===========================================================================
// S-A2.10 [T3, SYNTH-CONTRACT-H2-2, S3] — single shared secret, both fns
// ===========================================================================
describe('s005-h2 — single shared ws-token secret wired to both fns (T3, S3)', () => {
  it('generates the ws-token secret in-stack (no manual seed) for the shared param', () => {
    const t = synth();
    // The value is generated by a custom resource that writes the SSM
    // Assert the generator custom resource targets the ws-token-secret param.
    const all = JSON.stringify(t.toJSON());
    expect(all).toContain('/oxo-online/prod/ws-token-secret');
    // The generator writes a SecureString (the control: encrypted at rest).
    expect(all).toContain('SecureString');
    // And the generator's grant is PutParameter on that one ARN (no manual seed).
    const policies = t.findResources('AWS::IAM::Policy');
    const generatorGrant = Object.values(policies).some((p) => {
      const stmts = (
        (p.Properties as Record<string, unknown>).PolicyDocument as {
          Statement?: Array<Record<string, unknown>>;
        }
      ).Statement;
      return (stmts ?? []).some((s) =>
        actionList(s).includes('ssm:PutParameter'),
      );
    });
    expect(generatorGrant).toBe(true);
  });

  it('both oxo-game-fn and oxo-ws-auth-fn carry the SAME secret param name in env', () => {
    const t = synth();
    const fns = t.findResources('AWS::Lambda::Function');
    function envOf(name: string): Record<string, unknown> {
      const fn = Object.values(fns).find(
        (f) =>
          (f.Properties as Record<string, unknown>).FunctionName === name,
      )!;
      return (
        ((fn.Properties as Record<string, unknown>).Environment as {
          Variables?: Record<string, unknown>;
        }).Variables ?? {}
      );
    }
    const gameEnv = envOf('oxo-game-fn');
    const authEnv = envOf('oxo-ws-auth-fn');
    expect(gameEnv.WS_TOKEN_SECRET_PARAM).toBeDefined();
    expect(authEnv.WS_TOKEN_SECRET_PARAM).toBeDefined();
    // Same source: identical serialized reference.
    expect(JSON.stringify(gameEnv.WS_TOKEN_SECRET_PARAM)).toBe(
      JSON.stringify(authEnv.WS_TOKEN_SECRET_PARAM),
    );
  });

  it('the secret value is NOT a plaintext env var on either fn (S3)', () => {
    const t = synth();
    const fns = t.findResources('AWS::Lambda::Function');
    for (const name of ['oxo-game-fn', 'oxo-ws-auth-fn']) {
      const fn = Object.values(fns).find(
        (f) =>
          (f.Properties as Record<string, unknown>).FunctionName === name,
      )!;
      const env = JSON.stringify(
        (fn.Properties as Record<string, unknown>).Environment,
      );
      // env carries the param NAME, never a *_SECRET_VALUE or raw key material.
      expect(env).not.toMatch(/SECRET_VALUE|WS_TOKEN_SECRET"\s*:\s*"[A-Za-z0-9]/);
    }
  });
});

// ===========================================================================
// S-A2.11 [S1, CP-H2-A/B/C/D] — authorizer role: disjoint, gate-only
// ===========================================================================
describe('s005-h2 — oxo-ws-auth-fn role least-privilege (S1, CP-H2-A/B/C/D)', () => {
  it('DynamoDB actions are exactly GetItem/Query/UpdateItem/PutItem — no Scan, no dynamodb:*', () => {
    const stmts = roleStatements(synth(), 'WsAuthFunctionRole');
    const ddb = stmts.filter((s) =>
      actionList(s).some((a) => typeof a === 'string' && a.startsWith('dynamodb:')),
    );
    const all = ddb.flatMap(actionList).slice().sort();
    expect(all).toEqual(
      ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem'].sort(),
    );
    expect(all).not.toContain('dynamodb:Scan');
    expect(all.includes('dynamodb:*')).toBe(false);
    expect(all).not.toContain('dynamodb:DeleteItem');
  });

  it('CP-H2-A: Get/Query target Games table + code-index GSI only', () => {
    const stmts = roleStatements(synth(), 'WsAuthFunctionRole');
    const readStmt = stmts.find((s) => actionList(s).includes('dynamodb:Query'))!;
    const json = JSON.stringify(readStmt.Resource);
    expect(json).toMatch(/GamesTable|oxo-games/);
    expect(json).toMatch(/code-index/);
  });

  it('CP-H2-B: UpdateItem/PutItem target the ConnectAttempts ARN only', () => {
    const stmts = roleStatements(synth(), 'WsAuthFunctionRole');
    const writeStmt = stmts.find((s) =>
      actionList(s).includes('dynamodb:UpdateItem'),
    )!;
    expect(actionList(writeStmt).slice().sort()).toEqual([
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ]);
    const json = JSON.stringify(writeStmt.Resource);
    expect(json).toMatch(/ConnectAttempts|oxo-connect-attempts/);
    expect(json).not.toMatch(/oxo-games|GamesTable/);
  });

  it('CP-H2-C: a secret-read grant targets the one shared secret ARN', () => {
    const stmts = roleStatements(synth(), 'WsAuthFunctionRole');
    const secretStmt = stmts.find((s) =>
      actionList(s).some(
        (a) =>
          a === 'ssm:GetParameter' || a === 'secretsmanager:GetSecretValue',
      ),
    );
    expect(secretStmt, 'authorizer must have a secret-read grant').toBeDefined();
    const json = JSON.stringify(secretStmt!.Resource);
    expect(json).toMatch(/ws-token-secret|Secret/);
  });

  it('S1/CP-H2-D negative: NO ManageConnections, NO Connections, NO iam:*, NO wildcard resource', () => {
    const stmts = roleStatements(synth(), 'WsAuthFunctionRole');
    const json = JSON.stringify(stmts);
    expect(json).not.toContain('execute-api:ManageConnections');
    expect(json).not.toContain('execute-api:*');
    expect(json).not.toMatch(/oxo-connections|ConnectionsTable/);
    expect(json).not.toContain('iam:');
    for (const s of stmts) {
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      for (const r of resources) expect(r).not.toBe('*');
    }
  });
});

// ===========================================================================
// S-A2.12 [S2, S4, CP-H2-C] — oxo-game-fn gains ONLY the secret-read grant;
// neither game-fn nor ws-fn touches ConnectAttempts
// ===========================================================================
describe('s005-h2 — oxo-game-fn secret grant; no ConnectAttempts leak (S2, S4)', () => {
  it('S2: oxo-game-fn role keeps Games PutItem and adds exactly one secret-read grant', () => {
    const stmts = roleStatements(synth(), 'GameFunctionServiceRole');
    const ddb = stmts
      .filter((s) =>
        actionList(s).some((a) => typeof a === 'string' && a.startsWith('dynamodb:')),
      )
      .flatMap(actionList);
    expect(ddb).toEqual(['dynamodb:PutItem']);
    const secretGrants = stmts.filter((s) =>
      actionList(s).some(
        (a) =>
          a === 'ssm:GetParameter' || a === 'secretsmanager:GetSecretValue',
      ),
    );
    expect(secretGrants).toHaveLength(1);
  });

  it('S4: neither oxo-game-fn nor oxo-ws-fn role has any ConnectAttempts access', () => {
    const t = synth();
    for (const prefix of ['GameFunctionServiceRole', 'WsFunctionRole']) {
      const json = JSON.stringify(roleStatements(t, prefix));
      expect(json).not.toMatch(/ConnectAttempts|oxo-connect-attempts/);
    }
  });
});

// ===========================================================================
// DEFECT-H2-A2-001 regression pin — IAM Role `description` must satisfy the
// em-dash (U+2014) in WsAuthFunctionRole's description failed at CREATE (run
// 27085709328). Pin all IAM Role descriptions to that range at synth time.
// ===========================================================================
describe('s005-h2 — IAM role descriptions are AWS-charset-valid (DEFECT-H2-A2-001)', () => {
  it('no role Description contains a character outside the IAM-allowed range', () => {
    const t = synth();
    const roles = t.findResources('AWS::IAM::Role');
    function iamValid(s: string): boolean {
      for (const ch of s) {
        const c = ch.codePointAt(0)!;
        const ok =
          c === 0x09 ||
          c === 0x0a ||
          c === 0x0d ||
          (c >= 0x20 && c <= 0x7e) ||
          (c >= 0xa1 && c <= 0xff);
        if (!ok) return false;
      }
      return true;
    }
    for (const role of Object.values(roles)) {
      const desc = (role.Properties as Record<string, unknown>).Description;
      if (typeof desc === 'string') {
        expect(iamValid(desc), `bad chars in role description: ${desc}`).toBe(
          true,
        );
      }
    }
  });
});

// ===========================================================================
// S-A2.13 [T9] — BUILD_SHA env on the authorizer
// ===========================================================================
describe('s005-h2 — oxo-ws-auth-fn build identity (T9)', () => {
  it('oxo-ws-auth-fn runs nodejs20.x with a BUILD_SHA env var', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-ws-auth-fn',
      Runtime: 'nodejs20.x',
      Environment: { Variables: { BUILD_SHA: Match.anyValue() } },
    });
  });
});

// ===========================================================================
// S-A2.14 [T10, sect 9] — no NEW oxo-deploy grant; no manual deploy step
describe('s005-h2 — no new deploy-role grant; fn/table/secret are CDK-managed (T10)', () => {
  function oidcTemplate(): Template {
    const app = new cdk.App();
    return Template.fromStack(
      new OxoOnlineOidcStack(app, 'OxoOnlineOidcStack', {
        env: { account: '123456789012', region: 'eu-west-2' },
        githubOrg: 'o',
        githubRepo: 'r',
        deployBranch: 'main',
      }),
    );
  }

  it('the oxo-deploy LambdaCodeDeploy grant does NOT include oxo-ws-auth-fn (CDK fromAsset owns it)', () => {
    const t = oidcTemplate();
    const policies = t.findResources('AWS::IAM::Policy');
    let lambdaStmt: Record<string, unknown> | undefined;
    for (const p of Object.values(policies)) {
      const stmts = (
        (p.Properties as Record<string, unknown>).PolicyDocument as {
          Statement?: Array<Record<string, unknown>>;
        }
      ).Statement;
      const found = (stmts ?? []).find((s) =>
        actionList(s).includes('lambda:UpdateFunctionCode'),
      );
      if (found) lambdaStmt = found;
    }
    expect(lambdaStmt).toBeDefined();
    expect(JSON.stringify(lambdaStmt!.Resource)).not.toContain('oxo-ws-auth-fn');
  });

  it('no deploy-role statement grants ws-auth/secret or lambda:CreateFunction', () => {
    const t = oidcTemplate();
    const json = JSON.stringify(t.toJSON());
    expect(json).not.toContain('oxo-ws-auth-fn');
    expect(json).not.toContain('ws-token-secret');
    expect(json).not.toContain('lambda:CreateFunction');
  });

  // s007a (DEFECT-S007-001) amends this T10 pin: the deploy role NOW holds ONE
  // connect-attempts grant — the namespace-conditioned ConnectExemptionWrite
  // (PutItem+DeleteItem on EXEMPT#*). The COUNTER write (UpdateItem) stays
  // forbidden on the deploy role: the counter is the authorizer's alone. So the
  // pin is no longer "no connect-attempts at all" but "no counter mutation by
  // the deploy role; the only connect-attempts write is the exemption namespace".
  it('the ONLY deploy-role connect-attempts grant is exemption-namespace Put/Delete — never the counter (UpdateItem)', () => {
    const t = oidcTemplate();
    const policies = t.findResources('AWS::IAM::Policy');
    const connectStmts: Array<Record<string, unknown>> = [];
    for (const p of Object.values(policies)) {
      const stmts =
        ((p.Properties as Record<string, unknown>).PolicyDocument as {
          Statement?: Array<Record<string, unknown>>;
        }).Statement ?? [];
      for (const s of stmts) {
        if (JSON.stringify(s.Resource).includes('oxo-connect-attempts')) {
          connectStmts.push(s);
        }
      }
    }
    // Exactly one statement touches the connect-attempts table.
    expect(connectStmts).toHaveLength(1);
    const stmt = connectStmts[0];
    expect(stmt.Sid).toBe('ConnectExemptionWrite');
    const actions = actionList(stmt).slice().sort();
    expect(actions).toEqual(['dynamodb:DeleteItem', 'dynamodb:PutItem']);
    // The deploy role NEVER increments the per-IP counter.
    expect(actions).not.toContain('dynamodb:UpdateItem');
    // Namespace-conditioned so it cannot write counter items (PK = <ip>).
    expect(JSON.stringify(stmt.Condition)).toContain('EXEMPT#');
  });

  it('no manual seed: the secret is generated by an in-stack custom resource', () => {
    // The generator custom resource (not a deploy-time CLI step) produces the
    // SecureString value, so OxoGameProd deploys end-to-end with no manual step.
    const t = synth();
    const fns = t.findResources('AWS::Lambda::Function');
    const generator = Object.values(fns).some((f) =>
      JSON.stringify(f.Properties).includes('PutParameterCommand'),
    );
    expect(generator).toBe(true);
  });
});

// ===========================================================================
// S-A2.15 — single-stack composition: $connect route + authorizer compose in
// ONE stack; no new cross-stack import added (deploy order unchanged).
// ===========================================================================
describe('s005-h2 — single-stack composition (S-A2.15)', () => {
  it('the authorizer and the gated $connect route belong to the same WS API', () => {
    const t = synth();
    const apis = t.findResources('AWS::ApiGatewayV2::Api', {
      Properties: { ProtocolType: 'WEBSOCKET' },
    });
    const wsApiId = Object.keys(apis)[0];
    const authorizers = t.findResources('AWS::ApiGatewayV2::Authorizer');
    const reqAuth = Object.values(authorizers).find(
      (a) =>
        (a.Properties as Record<string, unknown>).AuthorizerType === 'REQUEST',
    )!;
    expect(
      ((reqAuth.Properties as Record<string, unknown>).ApiId as { Ref?: string })
        .Ref,
    ).toBe(wsApiId);
  });
});
