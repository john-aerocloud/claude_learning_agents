import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';

function synth(): Template {
  const app = new cdk.App();
  const stack = new OxoGameStack(app, 'OxoGameProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
  return Template.fromStack(stack);
}

describe('OxoGameStack — Games table exists (Step 4 harness)', () => {
  it('synthesises exactly one DynamoDB table', () => {
    const template = synth();
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });
});

describe('OxoGameStack — Games table shape (T1, S3)', () => {
  it('uses gameId as the HASH key', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    });
  });

  it('enables TTL on the ttl attribute', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });

  it('enables server-side encryption at rest (SSE)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('uses on-demand (pay-per-request) billing', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('declares no public resource policy on the table (S3)', () => {
    const template = synth();
    // DynamoDB tables in this slice have no resource-based policy at all; if one
    // were ever added it must never grant a public/anonymous principal.
    const tables = template.findResources('AWS::DynamoDB::Table');
    for (const table of Object.values(tables)) {
      const policy = (table.Properties as Record<string, unknown>)
        ?.ResourcePolicy;
      expect(policy).toBeUndefined();
    }
  });
});
