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

// DEFECT-005-001-R2 (second root cause of the live pairing failures). The CSP
// shipped with connect-src 'self', which silently BLOCKS the browser from
// opening the cross-origin WebSocket to the execute-api WSS endpoint — the
// online game could never connect (the SPA degraded to the generic error). The
// /api/* fetch stays same-origin (routed via CloudFront), so 'self' covers it;
// the WSS endpoint is a different origin and MUST be allow-listed in connect-src.
describe('OxoOnlineShellStack — CSP allows the WebSocket endpoint (DEFECT-005-001-R2)', () => {
  it('connect-src permits the wss execute-api origin alongside self', () => {
    const template = synth();
    const policies = template.findResources(
      'AWS::CloudFront::ResponseHeadersPolicy',
    );
    const policy = Object.values(policies)[0] as Record<string, unknown>;
    const csp = JSON.stringify(
      (policy.Properties as Record<string, unknown>) ?? {},
    );
    // The CSP must still scope connect-src (no wildcard 'all') AND include the
    // wss execute-api host so the browser can open the WebSocket.
    expect(csp).toContain('connect-src');
    expect(csp).toContain('wss://');
    expect(csp).toContain('execute-api');
  });
});
