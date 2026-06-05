import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
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

describe('OxoGameStack — Lambda oxo-game-fn (T3, T5, S3)', () => {
  it('runs on nodejs20.x with a fixed function name', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'oxo-game-fn',
      Runtime: 'nodejs20.x',
      Handler: 'handler.handler',
    });
  });

  it('passes the table name via the TABLE_NAME environment variable', () => {
    const template = synth();
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { TABLE_NAME: Match.anyValue() } },
    });
  });

  it('caps reserved concurrency above zero (T5)', () => {
    const template = synth();
    const fns = template.findResources('AWS::Lambda::Function', {
      Properties: { FunctionName: 'oxo-game-fn' },
    });
    const fn = Object.values(fns)[0];
    expect(fn.Properties.ReservedConcurrentExecutions).toBeGreaterThan(0);
  });

  it('grants only dynamodb:PutItem on the Games table ARN — no wildcard, no read/scan (T3)', () => {
    const template = synth();
    const policies = template.findResources('AWS::IAM::Policy');
    // Find the policy statement(s) referencing DynamoDB.
    const ddbStatements: Array<Record<string, unknown>> = [];
    for (const policy of Object.values(policies)) {
      const stmts = (policy.Properties.PolicyDocument.Statement ??
        []) as Array<Record<string, unknown>>;
      for (const stmt of stmts) {
        const action = stmt.Action;
        const actions = Array.isArray(action) ? action : [action];
        if (actions.some((a) => typeof a === 'string' && a.startsWith('dynamodb:'))) {
          ddbStatements.push(stmt);
        }
      }
    }
    expect(ddbStatements.length).toBeGreaterThan(0);
    for (const stmt of ddbStatements) {
      const action = stmt.Action;
      const actions = Array.isArray(action) ? action : [action];
      // Only PutItem — no read/query/scan/getitem.
      expect(actions).toEqual(['dynamodb:PutItem']);
      // Resource must reference the table ARN, never a bare '*'.
      expect(stmt.Resource).not.toBe('*');
      const resources = Array.isArray(stmt.Resource)
        ? stmt.Resource
        : [stmt.Resource];
      for (const r of resources) {
        expect(r).not.toBe('*');
      }
    }
  });
});
