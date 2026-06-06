import * as cdk from 'aws-cdk-lib';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

/**
 * s005-h1-waf — Global (CloudFront) WAFv2 WebACL stack.
 *
 * REGION-POLICY EXCEPTION (delta §3): the single-region default is eu-west-2,
 * but a CLOUDFRONT-scope WAFv2 WebACL MUST be created in us-east-1 (AWS hard
 * constraint). This stack therefore pins env.region = 'us-east-1' and holds
 * ONLY the platform-forced WebACL — nothing else — so the exception stays
 * minimal and justified. The WebACL ARN is exported as a public readonly
 * stack property and handed cross-region to OxoOnlineProd's distribution
 * `webAclId` via CDK crossRegionReferences (SSM parameter in us-east-1, read
 * by a custom resource in eu-west-2). SYNTH-CONTRACT-WAF-1/2 pin the handoff.
 */

/**
 * Rate-based rule threshold for the global CloudFront WebACL:
 * requests per 5-minute window per source IP, above which the IP is blocked.
 * Pre-launch placeholder (delta §9 open risk 1) — re-calibrate against real
 * traffic before any public launch. Exported so the synth test can pin the
 * synthesised limit to this constant (no magic literal in the rule).
 */
export const CF_RATE_LIMIT_PER_5MIN = 100;

const IP_REPUTATION_GROUP = 'AWSManagedRulesAmazonIpReputationList';

export class OxoOnlineWafUsEast1Stack extends cdk.Stack {
  /** ARN of the global CLOUDFRONT WebACL — handed cross-region to OxoOnlineProd. */
  public readonly webAclArn: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const webAcl = new wafv2.CfnWebACL(this, 'GlobalWebAcl', {
      name: 'oxo-online-cf-global',
      // Default-allow: WAF is transparent to legitimate traffic; only the
      // rate rule + reputation group block. Bounds anonymous flood without
      // gating normal players.
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      // Build-identity tags carried on the control-plane resource itself
      // (DEPLOY-IDENTITY-WAF, principles/01) — set explicitly so the ACL is
      // version-attributable even though stack-tag aspects also apply.
      tags: [
        { key: 'Project', value: 'oxo-online' },
        { key: 'Env', value: 'prod' },
        { key: 'ManagedBy', value: 'cdk' },
      ],
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: 'oxo-online-cf-global',
      },
      rules: [
        // Priority 0 — AWS-managed IP reputation list (action from the group).
        {
          name: 'AwsIpReputation',
          priority: 0,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: IP_REPUTATION_GROUP,
            },
          },
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: 'oxo-cf-ip-reputation',
          },
        },
        // Priority 1 — rate-based rule, aggregate by source IP. Threshold
        // sourced from the named constant (CF_RATE_LIMIT_PER_5MIN) — no magic
        // literal here, pinned by the synth test.
        {
          name: 'RateLimitPerIp',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: CF_RATE_LIMIT_PER_5MIN,
              aggregateKeyType: 'IP',
            },
          },
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            sampledRequestsEnabled: true,
            metricName: 'oxo-cf-rate-limit',
          },
        },
      ],
    });

    this.webAclArn = webAcl.attrArn;
  }
}
