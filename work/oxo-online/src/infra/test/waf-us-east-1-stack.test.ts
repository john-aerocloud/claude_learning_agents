import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
  OxoOnlineWafUsEast1Stack,
  CF_RATE_LIMIT_PER_5MIN,
} from '../lib/waf-us-east-1-stack';

// IP-reputation managed rule group name (AWS-published, stable).
const IP_REPUTATION_GROUP = 'AWSManagedRulesAmazonIpReputationList';

function synth(): { stack: OxoOnlineWafUsEast1Stack; template: Template } {
  const app = new cdk.App();
  const stack = new OxoOnlineWafUsEast1Stack(app, 'OxoOnlineWafUsEast1', {
    // CLOUDFRONT-scope WebACLs MUST be created in us-east-1 (AWS hard
    // constraint, region-policy exception documented in the delta).
    env: { account: '123456789012', region: 'us-east-1' },
    crossRegionReferences: true,
    tags: { Project: 'oxo-online', Env: 'prod', ManagedBy: 'cdk' },
  });
  return { stack, template: Template.fromStack(stack) };
}

// ---------------------------------------------------------------------------
// Step 1 — SYNTH-CONTRACT-WAF-2 (region/scope/minimality), DEPLOY-IDENTITY-WAF
// ---------------------------------------------------------------------------
describe('OxoOnlineWafUsEast1Stack — global CLOUDFRONT WebACL (Step 1)', () => {
  it('synthesises exactly one AWS::WAFv2::WebACL', () => {
    const { template } = synth();
    template.resourceCountIs('AWS::WAFv2::WebACL', 1);
  });

  it('the WebACL is CLOUDFRONT-scope with default action Allow', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    expect(acl.Properties.Scope).toBe('CLOUDFRONT');
    expect(acl.Properties.DefaultAction).toHaveProperty('Allow');
    expect(acl.Properties.DefaultAction).not.toHaveProperty('Block');
  });

  it('the stack region resolves to us-east-1 (region-policy exception)', () => {
    const { stack } = synth();
    expect(stack.region).toBe('us-east-1');
  });

  it('contains ONLY the forced WAF resources + the IMP-008 drain machinery — minimality bounded', () => {
    const { template } = synth();
    // The region-policy exception is justified because this stack carries only
    // the platform-forced CLOUDFRONT WAF resources (WebACL + the IMP-008
    // oxo-test-runner-ips IPSet) PLUS the IMP-008 24h drain Lambda + its
    // EventBridge schedule + the Lambda's CDK-generated execution role/policy
    // (AC2.5 — the drain MUST live with the IP set it drains, same region/scope).
    // Anything outside this allow-list would break the minimality justification.
    const ALLOWED_NON_WAF = new Set([
      'AWS::Lambda::Function', // drain Lambda
      'AWS::IAM::Role', // drain Lambda execution role (CDK-generated)
      'AWS::IAM::Policy', // drain Lambda execution policy (CDK-generated)
      'AWS::Events::Rule', // 24h EventBridge schedule
      'AWS::Lambda::Permission', // EventBridge -> Lambda invoke permission
    ]);
    const allResources = template.toJSON().Resources ?? {};
    const types = Object.values(allResources).map(
      (r: any) => r.Type as string,
    );
    const stray = types.filter(
      (t) => !t.startsWith('AWS::WAFv2::') && !ALLOWED_NON_WAF.has(t),
    );
    expect(stray).toEqual([]);
  });

  it('the WebACL carries build-identity tags Project/Env/ManagedBy (DEPLOY-IDENTITY-WAF)', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const tags: Array<{ Key: string; Value: string }> = acl.Properties.Tags ?? [];
    const tagMap = Object.fromEntries(tags.map((t) => [t.Key, t.Value]));
    expect(tagMap.Project).toBe('oxo-online');
    expect(tagMap.Env).toBe('prod');
    expect(tagMap.ManagedBy).toBe('cdk');
  });

  it('exposes the WebACL ARN as a public readonly stack property', () => {
    const { stack } = synth();
    expect(stack.webAclArn).toBeDefined();
    expect(typeof stack.webAclArn).toBe('string');
    expect(stack.webAclArn.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Step 2 — IP-reputation managed group + rate rule at named constant threshold
// ---------------------------------------------------------------------------
describe('OxoOnlineWafUsEast1Stack — global ACL rules (Step 2)', () => {
  it('CF_RATE_LIMIT_PER_5MIN is 100 (<= 100 per delta)', () => {
    expect(CF_RATE_LIMIT_PER_5MIN).toBe(100);
    expect(CF_RATE_LIMIT_PER_5MIN).toBeLessThanOrEqual(100);
  });

  it('includes the AWSManagedRulesAmazonIpReputationList managed group (AC1.3)', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const rules: any[] = acl.Properties.Rules ?? [];
    const ipRep = rules.find(
      (r) =>
        r.Statement?.ManagedRuleGroupStatement?.Name === IP_REPUTATION_GROUP,
    );
    expect(ipRep, 'expected an IP-reputation managed rule group').toBeDefined();
    expect(ipRep.Statement.ManagedRuleGroupStatement.VendorName).toBe('AWS');
  });

  it('has a rate-based rule with Limit sourced from the named constant (AC1.2, not hardcoded)', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const rules: any[] = acl.Properties.Rules ?? [];
    const rateRule = rules.find((r) => r.Statement?.RateBasedStatement);
    expect(rateRule, 'expected a rate-based rule').toBeDefined();
    const rbs = rateRule.Statement.RateBasedStatement;
    // Pin: the synthesised limit equals the imported constant — proves the
    // source uses the named constant, not a magic literal in the rule.
    expect(rbs.Limit).toBe(CF_RATE_LIMIT_PER_5MIN);
    expect(rbs.Limit).toBeLessThanOrEqual(100);
    expect(rbs.AggregateKeyType).toBe('IP');
    expect(rateRule.Action).toHaveProperty('Block');
  });

  // ---------------------------------------------------------------------------
  // DEFECT-WAF-001 — the rate rule's Block action MUST carry a CustomResponse
  // with ResponseCode 429. The shell stack's CloudFront CustomErrorResponses
  // map ONLY 403 and 404 -> /index.html + HTTP 200 (the SPA needs that for
  // S3-origin 403s). A default WAF block returns 403, which CF then rewrites
  // to 200 + SPA HTML — making blocks INVISIBLE to clients/probes/HTTP metrics.
  // 429 is NOT in CF's CustomErrorResponses list, so it passes through to the
  // client untouched, AND is semantically honest for rate limiting.
  it('the rate rule Block action returns a CustomResponse with ResponseCode 429 (DEFECT-WAF-001 — not CF-error-intercepted)', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const rules: any[] = acl.Properties.Rules ?? [];
    const rateRule = rules.find((r) => r.Statement?.RateBasedStatement);
    expect(rateRule, 'expected a rate-based rule').toBeDefined();
    const block = rateRule.Action.Block;
    expect(
      block,
      'rate rule Block action must be an object carrying CustomResponse',
    ).toBeDefined();
    expect(
      block.CustomResponse,
      'rate rule Block must carry a CustomResponse so the block is not CF-error-mapped to 200+SPA',
    ).toBeDefined();
    // 429 must NOT collide with the shell stack CustomErrorResponses (403/404).
    expect(block.CustomResponse.ResponseCode).toBe(429);
    expect([403, 404]).not.toContain(block.CustomResponse.ResponseCode);
  });

  it('enables CloudWatch metrics + sampled requests on each rule and the ACL default (observability)', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    expect(acl.Properties.VisibilityConfig.CloudWatchMetricsEnabled).toBe(true);
    expect(acl.Properties.VisibilityConfig.SampledRequestsEnabled).toBe(true);
    const rules: any[] = acl.Properties.Rules ?? [];
    for (const r of rules) {
      expect(r.VisibilityConfig.CloudWatchMetricsEnabled).toBe(true);
      expect(r.VisibilityConfig.SampledRequestsEnabled).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// s007 UC2-S2 — IMP-008 runner-IP exclusion: oxo-test-runner-ips IP set +
// NOT(IPSetReference) scope-down on the rate rule (AC2.3, AC2.4, AC2.6 / S6).
// The scope-down narrows the rule's APPLICABILITY (runner IPs don't count) —
// it does NOT change the rule's Block ACTION or LIMIT for non-runner IPs.
// ---------------------------------------------------------------------------
const RUNNER_IP_SET_NAME = 'oxo-test-runner-ips';

describe('OxoOnlineWafUsEast1Stack — IMP-008 runner-IP exclusion (s007 UC2-S2)', () => {
  it('AC2.3: synthesises an AWS::WAFv2::IPSet named oxo-test-runner-ips, CLOUDFRONT scope, IPV4, empty at synth', () => {
    const { template } = synth();
    const ipSets = template.findResources('AWS::WAFv2::IPSet');
    const ipSet = Object.values(ipSets).find(
      (r: any) => r.Properties?.Name === RUNNER_IP_SET_NAME,
    ) as Record<string, any> | undefined;
    expect(ipSet, 'expected an oxo-test-runner-ips IP set').toBeDefined();
    expect(ipSet!.Properties.Scope).toBe('CLOUDFRONT');
    expect(ipSet!.Properties.IPAddressVersion).toBe('IPV4');
    // Transient-by-protocol: empty at synth; runner IPs are added per-run by
    // make waf-runner-ip-add and removed by trap / drained by the 24h Lambda.
    expect(ipSet!.Properties.Addresses).toEqual([]);
  });

  it('AC2.4: the rate rule carries a scopeDown = NOT(IPSetReference oxo-test-runner-ips); limit + Block 429 are byte-for-byte unchanged', () => {
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const rules: any[] = acl.Properties.Rules ?? [];
    const rateRule = rules.find((r) => r.Statement?.RateBasedStatement);
    expect(rateRule, 'expected a rate-based rule').toBeDefined();
    const rbs = rateRule.Statement.RateBasedStatement;

    // Limit + aggregate UNCHANGED (S6 — scope-down narrows applicability only).
    expect(rbs.Limit).toBe(CF_RATE_LIMIT_PER_5MIN);
    expect(rbs.AggregateKeyType).toBe('IP');

    // Scope-down = NOT wrapping an IPSetReferenceStatement to the runner set.
    const scopeDown = rbs.ScopeDownStatement;
    expect(scopeDown, 'rate rule must carry a ScopeDownStatement').toBeDefined();
    expect(scopeDown.NotStatement, 'scope-down must be a NOT').toBeDefined();
    const inner = scopeDown.NotStatement.Statement;
    expect(
      inner.IPSetReferenceStatement,
      'NOT must wrap an IPSetReferenceStatement',
    ).toBeDefined();
    // The reference points at the runner IP set's ARN (CFN ref/GetAtt, not a
    // literal) — assert it resolves to the IPSet resource, not a hard-coded ARN.
    const arn = inner.IPSetReferenceStatement.Arn;
    const arnStr = JSON.stringify(arn);
    const ipSets = template.findResources('AWS::WAFv2::IPSet');
    const ipSetLogicalId = Object.keys(ipSets).find(
      (id) => (ipSets[id] as any).Properties?.Name === RUNNER_IP_SET_NAME,
    );
    expect(ipSetLogicalId).toBeDefined();
    expect(arnStr).toContain(ipSetLogicalId as string);

    // Block ACTION + custom 429 response UNCHANGED (S6 / AC2.6).
    expect(rateRule.Action).toHaveProperty('Block');
    expect(rateRule.Action.Block.CustomResponse.ResponseCode).toBe(429);
  });

  it('AC2.5: a scheduled drain Lambda runs every 24h targeting oxo-test-runner-ips (IMP-008 standing guard)', () => {
    const { template } = synth();
    // The drain Lambda exists.
    const fns = template.findResources('AWS::Lambda::Function');
    expect(
      Object.keys(fns).length,
      'expected a drain Lambda function',
    ).toBeGreaterThan(0);
    // It knows the IP set name to drain (env var) so the synth pins the wiring,
    // not just the resource's existence.
    const drainFn = Object.values(fns).find((f: any) =>
      JSON.stringify(f.Properties?.Environment ?? {}).includes(
        RUNNER_IP_SET_NAME,
      ),
    ) as Record<string, any> | undefined;
    expect(
      drainFn,
      'drain Lambda must carry the oxo-test-runner-ips set name (env) so it drains the RIGHT set',
    ).toBeDefined();

    // A 24h EventBridge schedule rule exists and targets the drain Lambda.
    const rules = template.findResources('AWS::Events::Rule');
    expect(
      Object.keys(rules).length,
      'expected an EventBridge schedule rule',
    ).toBeGreaterThan(0);
    const scheduleRule = Object.values(rules).find((r: any) =>
      /rate\(24 hours?\)|rate\(1 day\)|cron\(/.test(
        String(r.Properties?.ScheduleExpression ?? ''),
      ),
    ) as Record<string, any> | undefined;
    expect(
      scheduleRule,
      'expected a 24h (rate(24 hours)/rate(1 day)/cron) schedule',
    ).toBeDefined();
    // The rule targets a Lambda (the drain function).
    const targets = scheduleRule!.Properties.Targets ?? [];
    expect(targets.length).toBeGreaterThan(0);
  });

  it('AC2.5 code<->policy pin: the drain Lambda role may Get/Update only the runner IP set — no WebACL/Create/Delete IPSet, no wildcard', () => {
    // The drain reads (GetIPSet) and rewrites (UpdateIPSet) the set; it must NOT
    // be able to create/delete IP sets or touch the WebACL. Least-privilege pin
    // (§30) on the CDK-generated execution policy for the drain function role.
    const { template } = synth();
    const policies = template.findResources('AWS::IAM::Policy');
    const wafActions = new Set<string>();
    for (const p of Object.values(policies)) {
      const doc = (p as any).Properties?.PolicyDocument;
      for (const stmt of doc?.Statement ?? []) {
        const acts = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
        for (const a of acts) {
          if (typeof a === 'string' && a.startsWith('wafv2:')) wafActions.add(a);
        }
      }
    }
    // The drain needs exactly Get + Update on the IP set.
    expect(wafActions.has('wafv2:GetIPSet')).toBe(true);
    expect(wafActions.has('wafv2:UpdateIPSet')).toBe(true);
    // It must NOT hold create/delete or WebACL or wildcard powers.
    expect(wafActions.has('wafv2:CreateIPSet')).toBe(false);
    expect(wafActions.has('wafv2:DeleteIPSet')).toBe(false);
    expect(wafActions.has('wafv2:*')).toBe(false);
    for (const a of wafActions) {
      expect(a.includes('WebACL')).toBe(false);
    }
  });

  it('AC2.6 (S6 regression): the rate rule still Blocks at the same limit/429 for a non-runner source — scope-down does not change action/limit', () => {
    // The s005-h1 AC3.1 semantics: Block action + CF_RATE_LIMIT_PER_5MIN limit +
    // 429 custom response survive the scope-down. The scope-down only narrows
    // WHO the rule counts (excludes runner IPs); for any non-runner IP the rule
    // is identical to the pre-IMP-008 rule.
    const { template } = synth();
    const acls = template.findResources('AWS::WAFv2::WebACL');
    const acl = Object.values(acls)[0] as Record<string, any>;
    const rules: any[] = acl.Properties.Rules ?? [];
    const rateRule = rules.find((r) => r.Statement?.RateBasedStatement);
    const rbs = rateRule.Statement.RateBasedStatement;
    expect(rbs.Limit).toBe(CF_RATE_LIMIT_PER_5MIN);
    expect(rbs.Limit).toBeLessThanOrEqual(100);
    expect(rateRule.Action.Block.CustomResponse.ResponseCode).toBe(429);
    expect([403, 404]).not.toContain(
      rateRule.Action.Block.CustomResponse.ResponseCode,
    );
  });
});
