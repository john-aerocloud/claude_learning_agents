import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoOnlineShellStack } from '../lib/oxo-online-shell-stack';

// Managed CachingDisabled policy id (AWS-published, stable across accounts).
const CACHING_DISABLED_ID = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

function synth(): Template {
  const app = new cdk.App();
  const stack = new OxoOnlineShellStack(app, 'OxoOnlineProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
  return Template.fromStack(stack);
}

describe('OxoOnlineShellStack — /api/* behaviour is CachingDisabled (T2)', () => {
  it('adds a cache behaviour for /api/* using the managed CachingDisabled policy', () => {
    const template = synth();
    const dists = template.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0];
    const config = dist.Properties.DistributionConfig;
    const behaviours = config.CacheBehaviors ?? [];
    const apiBehaviour = behaviours.find(
      (b: Record<string, unknown>) => b.PathPattern === '/api/*',
    );
    expect(apiBehaviour, 'expected an /api/* cache behaviour').toBeDefined();
    expect(apiBehaviour.CachePolicyId).toBe(CACHING_DISABLED_ID);
  });

  it('serves /api/* over HTTPS only to the origin and allows all methods', () => {
    const template = synth();
    const dists = template.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0];
    const behaviours =
      dist.Properties.DistributionConfig.CacheBehaviors ?? [];
    const apiBehaviour = behaviours.find(
      (b: Record<string, unknown>) => b.PathPattern === '/api/*',
    );
    // POST must be allowed for create-game.
    expect(apiBehaviour.AllowedMethods).toContain('POST');
    expect(apiBehaviour.ViewerProtocolPolicy).toBe('redirect-to-https');
  });
});
