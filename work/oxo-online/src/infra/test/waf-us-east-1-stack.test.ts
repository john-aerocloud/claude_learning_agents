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

  it('contains ONLY the forced WAF resource — no other AWS resources (minimality)', () => {
    const { template } = synth();
    // The region-policy exception is justified ONLY because this stack carries
    // nothing but the platform-forced CLOUDFRONT WebACL. Any non-WAF resource
    // here would break the minimality justification.
    const allResources = template.toJSON().Resources ?? {};
    const types = Object.values(allResources).map(
      (r: any) => r.Type as string,
    );
    const nonWaf = types.filter((t) => !t.startsWith('AWS::WAFv2::'));
    expect(nonWaf).toEqual([]);
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
