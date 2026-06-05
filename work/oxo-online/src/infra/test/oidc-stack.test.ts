import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoOnlineOidcStack } from '../lib/oxo-online-oidc-stack';

const ACCOUNT = '123456789012';
const REGION = 'eu-west-2';

function synth(): Template {
  const app = new cdk.App();
  const stack = new OxoOnlineOidcStack(app, 'OxoOnlineOidcStack', {
    env: { account: ACCOUNT, region: REGION },
    githubOrg: 'example-org',
    githubRepo: 'oxo-online',
    deployBranch: 'main',
  });
  return Template.fromStack(stack);
}

/** All policy statements attached to the oxo-deploy role (by logical ref). */
function deployRoleStatements(
  template: Template,
): Array<Record<string, unknown>> {
  // Find the logical id of the oxo-deploy role.
  const roles = template.findResources('AWS::IAM::Role', {
    Properties: { RoleName: 'oxo-deploy' },
  });
  const deployRoleId = Object.keys(roles)[0];
  expect(deployRoleId).toBeDefined();

  const statements: Array<Record<string, unknown>> = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const props = policy.Properties as Record<string, unknown>;
    const roleRefs = (props.Roles ?? []) as Array<Record<string, unknown>>;
    const attachedToDeployRole = roleRefs.some(
      (r) => (r as { Ref?: string }).Ref === deployRoleId,
    );
    if (!attachedToDeployRole) continue;
    const doc = props.PolicyDocument as { Statement?: unknown[] };
    for (const stmt of (doc.Statement ?? []) as Array<Record<string, unknown>>) {
      statements.push(stmt);
    }
  }
  return statements;
}

function actionsOf(stmt: Record<string, unknown>): string[] {
  const a = stmt.Action;
  return Array.isArray(a) ? (a as string[]) : [a as string];
}

function resourcesOf(stmt: Record<string, unknown>): unknown[] {
  const r = stmt.Resource;
  return Array.isArray(r) ? r : [r];
}

describe('OxoOnlineOidcStack — oxo-deploy gains scoped Lambda deploy perms (T4)', () => {
  it('grants lambda:UpdateFunctionCode and lambda:GetFunction', () => {
    const statements = deployRoleStatements(synth());
    const lambdaStmts = statements.filter((s) =>
      actionsOf(s).some((a) => typeof a === 'string' && a.startsWith('lambda:')),
    );
    expect(lambdaStmts.length).toBeGreaterThan(0);
    const lambdaActions = new Set(lambdaStmts.flatMap(actionsOf));
    expect(lambdaActions.has('lambda:UpdateFunctionCode')).toBe(true);
    expect(lambdaActions.has('lambda:GetFunction')).toBe(true);
  });

  it('scopes the Lambda actions to the oxo-game-fn ARN, never *', () => {
    const statements = deployRoleStatements(synth());
    const lambdaStmts = statements.filter((s) =>
      actionsOf(s).some((a) => typeof a === 'string' && a.startsWith('lambda:')),
    );
    for (const stmt of lambdaStmts) {
      for (const r of resourcesOf(stmt)) {
        expect(r).not.toBe('*');
        expect(typeof r).toBe('string');
        expect(r as string).toContain('function:oxo-game-fn');
      }
    }
  });
});

describe('OxoOnlineOidcStack — oxo-deploy has no IAM-mutation actions (S2)', () => {
  it('grants none of iam:CreateRole, iam:AttachRolePolicy, iam:PutRolePolicy on any resource', () => {
    const statements = deployRoleStatements(synth());
    const forbidden = new Set([
      'iam:CreateRole',
      'iam:AttachRolePolicy',
      'iam:PutRolePolicy',
    ]);
    const allActions = statements.flatMap(actionsOf);
    for (const action of allActions) {
      expect(forbidden.has(action)).toBe(false);
    }
  });
});
