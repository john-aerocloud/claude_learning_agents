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

  it('scopes the Lambda actions to a named oxo function ARN, never * (s005: game-fn + ws-fn)', () => {
    const statements = deployRoleStatements(synth());
    const lambdaStmts = statements.filter((s) =>
      actionsOf(s).some((a) => typeof a === 'string' && a.startsWith('lambda:')),
    );
    const allLambdaResources = lambdaStmts.flatMap(resourcesOf);
    // The create-game function ARN must still be in scope (s004 regression).
    expect(
      allLambdaResources.some(
        (r) => typeof r === 'string' && (r as string).includes('function:oxo-game-fn'),
      ),
    ).toBe(true);
    // Every Lambda resource is a named oxo-* function ARN — never a bare '*'.
    for (const stmt of lambdaStmts) {
      for (const r of resourcesOf(stmt)) {
        expect(r).not.toBe('*');
        expect(typeof r).toBe('string');
        expect(r as string).toContain('function:oxo-');
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

describe('OxoOnlineOidcStack — oxo-deploy WS Lambda deploy scope (s005 A0.6, S4)', () => {
  it('grants lambda:UpdateFunctionCode + lambda:GetFunction scoped to the oxo-ws-fn ARN (never *)', () => {
    const statements = deployRoleStatements(synth());
    const lambdaStmts = statements.filter((s) =>
      actionsOf(s).some(
        (a) => typeof a === 'string' && a.startsWith('lambda:'),
      ),
    );
    // The deploy role must be able to hot-swap oxo-ws-fn code, ARN-scoped.
    const wsStmts = lambdaStmts.filter((s) =>
      resourcesOf(s).some(
        (r) => typeof r === 'string' && (r as string).includes('function:oxo-ws-fn'),
      ),
    );
    expect(wsStmts.length).toBeGreaterThan(0);
    const wsActions = new Set(wsStmts.flatMap(actionsOf));
    expect(wsActions.has('lambda:UpdateFunctionCode')).toBe(true);
    expect(wsActions.has('lambda:GetFunction')).toBe(true);
    // Every Lambda statement is ARN-scoped — no bare '*'.
    for (const stmt of lambdaStmts) {
      for (const r of resourcesOf(stmt)) {
        expect(r).not.toBe('*');
        expect(typeof r).toBe('string');
        expect(r as string).toContain('function:oxo-');
      }
    }
  });

  it('grants none of iam:CreateRole / iam:AttachRolePolicy / iam:PutRolePolicy (S4)', () => {
    const statements = deployRoleStatements(synth());
    const forbidden = new Set([
      'iam:CreateRole',
      'iam:AttachRolePolicy',
      'iam:PutRolePolicy',
    ]);
    for (const action of statements.flatMap(actionsOf)) {
      expect(forbidden.has(action)).toBe(false);
    }
  });
});

// ===========================================================================
// s005-h1-waf — Step 6: oxo-deploy WAFv2 + CloudFront grants (ORDER-WAF-1,
// code<->policy pin per process v25 §30 / DEPLOY_ROLE_EXTENSIONS.md s005-h1).
// ===========================================================================

const EXPECTED_WAFV2_ACTIONS = [
  'wafv2:CreateWebACL',
  'wafv2:GetWebACL',
  'wafv2:UpdateWebACL',
  'wafv2:DeleteWebACL',
  'wafv2:ListWebACLs',
  'wafv2:TagResource',
  'wafv2:UntagResource',
  'wafv2:ListTagsForResource',
  'wafv2:AssociateWebACL',
  'wafv2:DisassociateWebACL',
  'wafv2:ListResourcesForWebACL',
  'wafv2:GetWebACLForResource',
];

const EXPECTED_CLOUDFRONT_WAF_ACTIONS = [
  'cloudfront:UpdateDistribution',
  'cloudfront:GetDistribution',
  'cloudfront:GetDistributionConfig',
];

describe('OxoOnlineOidcStack — oxo-deploy WAFv2 management grant (s005-h1 ORDER-WAF-1)', () => {
  it('grants exactly the enumerated wafv2 WebACL-management actions — no wafv2:* wildcard', () => {
    const statements = deployRoleStatements(synth());
    const wafStmts = statements.filter((s) =>
      actionsOf(s).some((a) => typeof a === 'string' && a.startsWith('wafv2:')),
    );
    expect(wafStmts.length).toBeGreaterThan(0);
    const granted = new Set(
      wafStmts.flatMap(actionsOf).filter((a) => a.startsWith('wafv2:')),
    );
    // No wildcard.
    expect(granted.has('wafv2:*')).toBe(false);
    // Every expected WebACL-management action is present.
    for (const action of EXPECTED_WAFV2_ACTIONS) {
      expect(granted.has(action)).toBe(true);
    }
    // No ungranted wafv2 action sneaks in beyond the enumerated WebACL set —
    // EXCEPT the IMP-008 IPSet-management family, which is a separate statement
    // (Ipv2IpSetManage) pinned by its own test below (code<->policy pin: each
    // statement's granted set cannot silently widen).
    const ipsetFamily = new Set([
      'wafv2:CreateIPSet',
      'wafv2:GetIPSet',
      'wafv2:UpdateIPSet',
      'wafv2:DeleteIPSet',
      'wafv2:ListIPSets',
    ]);
    for (const action of granted) {
      if (ipsetFamily.has(action)) continue;
      expect(EXPECTED_WAFV2_ACTIONS).toContain(action);
    }
  });

  it('does NOT grant wafv2:PutLoggingConfiguration (not needed; over-grant pin)', () => {
    const statements = deployRoleStatements(synth());
    const allActions = statements.flatMap(actionsOf);
    expect(allActions).not.toContain('wafv2:PutLoggingConfiguration');
  });
});

describe('OxoOnlineOidcStack — oxo-deploy CloudFront set-webAclId grant (s005-h1)', () => {
  it('grants UpdateDistribution + Get/GetConfig scoped to the E519HYABC57ZX distribution ARN, never cloudfront:*', () => {
    const statements = deployRoleStatements(synth());
    const cfWafStmts = statements.filter((s) =>
      actionsOf(s).some((a) => EXPECTED_CLOUDFRONT_WAF_ACTIONS.includes(a)),
    );
    expect(cfWafStmts.length).toBeGreaterThan(0);
    const granted = new Set(cfWafStmts.flatMap(actionsOf));
    for (const action of EXPECTED_CLOUDFRONT_WAF_ACTIONS) {
      expect(granted.has(action)).toBe(true);
    }
    expect(granted.has('cloudfront:*')).toBe(false);
    // Scoped to the specific distribution ARN — never '*'.
    for (const stmt of cfWafStmts) {
      for (const r of resourcesOf(stmt)) {
        expect(r).not.toBe('*');
        expect(typeof r).toBe('string');
        expect(r as string).toContain('distribution/E519HYABC57ZX');
      }
    }
  });

  it('does NOT grant cloudfront:CreateDistribution or cloudfront:DeleteDistribution (lifecycle is CDK-owned)', () => {
    const statements = deployRoleStatements(synth());
    const allActions = statements.flatMap(actionsOf);
    expect(allActions).not.toContain('cloudfront:CreateDistribution');
    expect(allActions).not.toContain('cloudfront:DeleteDistribution');
  });
});

// ===========================================================================
// s007 UC2-S0 — IMP-008 IPSet management grant (E1 BLOCKER, code<->policy pin
// per process v25 §30). The deploy role must hold EXACTLY the five IPSet
// management actions so the OxoOnlineWafUsEast1 stack can create + mutate the
// oxo-test-runner-ips IP set. §39 config-follows-resource: this grant is
// deployed via `make deploy-oidc` BEFORE any push that adds the IPSet CDK
// resource, exactly as Wafv2Manage was grant-before-WebACL at s005-h1.
// ===========================================================================

const EXPECTED_IPSET_ACTIONS = [
  'wafv2:CreateIPSet',
  'wafv2:GetIPSet',
  'wafv2:UpdateIPSet',
  'wafv2:DeleteIPSet',
  'wafv2:ListIPSets',
];

describe('OxoOnlineOidcStack — oxo-deploy IMP-008 IPSet management grant (s007 UC2-S0, E1)', () => {
  it('grants exactly the five wafv2 IPSet management actions — no wafv2:* wildcard, no IAM escalation', () => {
    const statements = deployRoleStatements(synth());
    const ipsetStmts = statements.filter((s) =>
      actionsOf(s).some(
        (a) => typeof a === 'string' && a.endsWith('IPSet') || a === 'wafv2:ListIPSets',
      ),
    );
    expect(ipsetStmts.length).toBeGreaterThan(0);
    const granted = new Set(
      statements
        .flatMap(actionsOf)
        .filter(
          (a) =>
            typeof a === 'string' &&
            (a.endsWith('IPSet') || a === 'wafv2:ListIPSets'),
        ),
    );
    // No wildcard.
    expect(granted.has('wafv2:*')).toBe(false);
    // Every expected IPSet management action is present.
    for (const action of EXPECTED_IPSET_ACTIONS) {
      expect(granted.has(action)).toBe(true);
    }
    // No ungranted IPSet-family action sneaks in beyond the enumerated set
    // (code<->policy pin: the granted IPSet set cannot silently widen).
    for (const action of granted) {
      expect(EXPECTED_IPSET_ACTIONS).toContain(action);
    }
  });

  it('still grants none of iam:CreateRole / iam:AttachRolePolicy / iam:PutRolePolicy after the IPSet additions', () => {
    const statements = deployRoleStatements(synth());
    const forbidden = new Set([
      'iam:CreateRole',
      'iam:AttachRolePolicy',
      'iam:PutRolePolicy',
    ]);
    for (const action of statements.flatMap(actionsOf)) {
      expect(forbidden.has(action)).toBe(false);
    }
  });
});

describe('OxoOnlineOidcStack — no IAM escalation alongside the WAF grants (code<->policy pin)', () => {
  it('still grants none of iam:CreateRole / iam:AttachRolePolicy / iam:PutRolePolicy after the WAF additions', () => {
    const statements = deployRoleStatements(synth());
    const forbidden = new Set([
      'iam:CreateRole',
      'iam:AttachRolePolicy',
      'iam:PutRolePolicy',
    ]);
    for (const action of statements.flatMap(actionsOf)) {
      expect(forbidden.has(action)).toBe(false);
    }
  });
});
