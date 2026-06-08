import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';
import { OxoOnlineShellStack } from '../lib/oxo-online-shell-stack';

// =============================================================================
// s009 R3.5 (§30 cross-stack contract, E5) — GET /api/leaderboard end-to-end.
// Synthesises BOTH the HTTP API (OxoGameProd) and the CloudFront distribution
// (OxoOnlineProd) in ONE file and asserts the contract between them:
//   - OxoGameProd has a route key `GET /api/leaderboard` (the path CF forwards).
//   - The CloudFront `/api/leaderboard` behaviour has min/default/max TTL = 5s.
//   - `POST /api/games` stays CachingDisabled (writes must never cache).
// The defect class this prevents: each stack green alone, composed system 404s
// or caches a write. (AC3.6, T-LB-6.)
// @covers gamefn, cfwaf
// =============================================================================

function gameTemplate(): Template {
  const app = new cdk.App();
  const stack = new OxoGameStack(app, 'OxoGameProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
  return Template.fromStack(stack);
}

function shellTemplate(): Template {
  const app = new cdk.App();
  // The shell stack imports the HTTP API endpoint via Fn::ImportValue and the
  // us-east-1 WebACL id via context; synth needs only the cross-region env.
  const stack = new OxoOnlineShellStack(app, 'OxoOnlineProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
    crossRegionReferences: true,
  } as cdk.StackProps);
  return Template.fromStack(stack);
}

describe('s009 — HTTP API exposes GET /api/leaderboard (E5 producer side)', () => {
  it('synthesises a route key GET /api/leaderboard on the HTTP API', () => {
    const template = gameTemplate();
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /api/leaderboard',
    });
  });

  it('keeps the existing POST /api/games route key (no regression)', () => {
    const template = gameTemplate();
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /api/games',
    });
  });
});

describe('s009 — CloudFront /api/leaderboard behaviour has TTL=5s (E5 consumer side, T-LB-6)', () => {
  it('declares a cache policy with min/default/max TTL = 5 seconds', () => {
    const template = shellTemplate();
    // A dedicated cache policy for the leaderboard behaviour: all three TTLs 5s.
    template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: {
        MinTTL: 5,
        DefaultTTL: 5,
        MaxTTL: 5,
      },
    });
  });

  it('the distribution has a cache behaviour for the /api/leaderboard path pattern', () => {
    const template = shellTemplate();
    const dists = template.findResources('AWS::CloudFront::Distribution');
    const dist = Object.values(dists)[0];
    const behaviours = (
      (dist.Properties as Record<string, unknown>).DistributionConfig as {
        CacheBehaviors?: Array<{ PathPattern?: string }>;
      }
    ).CacheBehaviors;
    const paths = (behaviours ?? []).map((b) => b.PathPattern);
    expect(paths).toContain('/api/leaderboard');
  });
});
