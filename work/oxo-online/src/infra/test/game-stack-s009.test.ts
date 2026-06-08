import { describe, it, expect } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { OxoGameStack } from '../lib/game-stack';

// =============================================================================
// s009 arcade-scoreboard — UC2 backend synth/policy pins (delta 010).
//   - R2.1: Leaderboard table (PITR, no TTL, SSE, on-demand) + Games stream.
//   - R2.2: IAM no-widening pins (board-fn, game-fn += Scan, ws-fn UNCHANGED,
//           deploy += scoped UpdateFunctionCode on board-fn ARN).
//   - R2.5: event-source-mapping filter criteria (MODIFY, status transition).
// These are the synth-time halves of T-LB-1, T-LB-9, AC2.1/2.2/2.3/3.7.
// @covers leaderboard, games, boardfn, gamefn, wsfn, games-stream, board-fn-handler
// =============================================================================

function synthStack(): OxoGameStack {
  const app = new cdk.App();
  return new OxoGameStack(app, 'OxoGameProd', {
    env: { account: '123456789012', region: 'eu-west-2' },
  });
}

function synth(): Template {
  return Template.fromStack(synthStack());
}

function actionList(stmt: Record<string, unknown>): string[] {
  const a = stmt.Action;
  return Array.isArray(a) ? (a as string[]) : [a as string];
}

/** All DynamoDB-action statements attached to the role whose logical id starts with `prefix`. */
function ddbStatementsForRole(
  template: Template,
  prefix: string,
): Array<Record<string, unknown>> {
  const roles = template.findResources('AWS::IAM::Role');
  const roleId = Object.keys(roles).find((id) => id.startsWith(prefix));
  expect(roleId, `role ${prefix} must exist`).toBeDefined();
  const out: Array<Record<string, unknown>> = [];
  const policies = template.findResources('AWS::IAM::Policy');
  for (const policy of Object.values(policies)) {
    const roleRefs = ((policy.Properties as Record<string, unknown>).Roles ??
      []) as Array<{ Ref?: string }>;
    if (!roleRefs.some((r) => r.Ref === roleId)) continue;
    const stmts = (
      (policy.Properties as Record<string, unknown>).PolicyDocument as {
        Statement?: unknown[];
      }
    ).Statement as Array<Record<string, unknown>>;
    for (const s of stmts ?? []) {
      const actions = actionList(s);
      if (actions.some((a) => typeof a === 'string' && a.startsWith('dynamodb:'))) {
        out.push(s);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// R2.1 — Leaderboard table shape (T-LB-1 / AC2.1).
// ---------------------------------------------------------------------------
describe('s009 — Leaderboard table shape (T-LB-1, AC2.1)', () => {
  it('keys on playerName (HASH) with no sort key', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-leaderboard',
      KeySchema: [{ AttributeName: 'playerName', KeyType: 'HASH' }],
    });
  });

  it('enables server-side encryption at rest (SSE)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-leaderboard',
      SSESpecification: { SSEEnabled: true },
    });
  });

  it('uses on-demand (pay-per-request) billing', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-leaderboard',
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  it('ENABLES PITR (first durable table — standings must survive)', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-leaderboard',
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  it('declares NO TTL attribute (standings persist by design)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-leaderboard' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    expect(props.TimeToLiveSpecification).toBeUndefined();
  });

  it('declares NO GSI (top-N is a small Scan at hobby scale)', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-leaderboard' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    expect(props.GlobalSecondaryIndexes).toBeUndefined();
  });

  it('declares no public resource policy on the Leaderboard table', () => {
    const template = synth();
    const tables = template.findResources('AWS::DynamoDB::Table', {
      Properties: { TableName: 'oxo-leaderboard' },
    });
    const props = Object.values(tables)[0].Properties as Record<string, unknown>;
    expect(props.ResourcePolicy).toBeUndefined();
  });

  it('synthesises FIVE DynamoDB tables now (Games + Connections + ConnectAttempts + Codes + Leaderboard)', () => {
    const template = synth();
    template.resourceCountIs('AWS::DynamoDB::Table', 5);
  });
});

// ---------------------------------------------------------------------------
// R2.1 — Games table gains a stream (NEW_AND_OLD_IMAGES), in-place UPDATE.
// The base KeySchema is UNCHANGED so this is a non-destructive UpdateTable, not
// a replacement. (T-LB-1 second half / AC2.1.)
// ---------------------------------------------------------------------------
describe('s009 — Games table gains NEW_AND_OLD_IMAGES stream (non-destructive update)', () => {
  it('sets StreamSpecification to NEW_AND_OLD_IMAGES on the Games table', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      StreamSpecification: { StreamViewType: 'NEW_AND_OLD_IMAGES' },
    });
  });

  it('leaves the Games base key schema UNCHANGED (gameId HASH) — not a replacement', () => {
    const template = synth();
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'oxo-games',
      KeySchema: [{ AttributeName: 'gameId', KeyType: 'HASH' }],
    });
  });
});

// ---------------------------------------------------------------------------
// R2.5 — board-fn event-source mapping filter criteria (AC2.2).
//   eventName=MODIFY, NEW.status ∈ {won,drawn}, OLD.status=active.
//   The filter is the waste-cut; the idempotency marker is the correctness gate.
// ---------------------------------------------------------------------------
describe('s009 — oxo-board-fn event-source mapping + filter criteria (AC2.2)', () => {
  it('creates exactly one event-source mapping (the Games stream → board-fn)', () => {
    const template = synth();
    template.resourceCountIs('AWS::Lambda::EventSourceMapping', 1);
  });

  it('pins the filter criteria to MODIFY + active→{won,drawn} transition', () => {
    const template = synth();
    const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
    const props = Object.values(mappings)[0].Properties as Record<string, unknown>;
    const filters = (props.FilterCriteria as { Filters?: Array<{ Pattern?: string }> })
      ?.Filters;
    expect(filters, 'event-source mapping must carry FilterCriteria').toBeDefined();
    // The patterns are JSON strings; collapse them and assert each clause appears.
    const patternBlob = (filters ?? [])
      .map((f) => f.Pattern ?? '')
      .join(' ');
    expect(patternBlob).toContain('MODIFY');
    // OLD-image status must equal active.
    expect(patternBlob).toContain('OldImage');
    // NEW-image status must be won OR drawn.
    expect(patternBlob).toContain('NewImage');
    expect(patternBlob).toContain('won');
    expect(patternBlob).toContain('drawn');
    expect(patternBlob).toContain('active');
  });

  it('starts the board-fn consumer with bisect-on-error so a poison record cannot stall the shard', () => {
    const template = synth();
    const mappings = template.findResources('AWS::Lambda::EventSourceMapping');
    const props = Object.values(mappings)[0].Properties as Record<string, unknown>;
    // BisectBatchOnFunctionError keeps a single bad record from wedging the shard
    // (board-fn swallows ConditionalCheckFailed, so the realistic poison is a
    // transient throttle — bisect + retries handle it; the off-path design means
    // a stuck shard never affects play).
    expect(props.BisectBatchOnFunctionError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R2.2 — IAM no-widening pins (T-LB-9 / AC2.3, AC3.7, AC5.12).
// ---------------------------------------------------------------------------
describe('s009 — oxo-board-fn IAM least privilege (AC2.3, T-LB-9)', () => {
  it('grants UpdateItem on the Leaderboard ARN only — no Scan/Query/Delete, no wildcard', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'BoardFunctionRole');
    // Find the Leaderboard statement.
    const lbStmt = stmts.find((s) =>
      JSON.stringify(s.Resource).includes('Leaderboard'),
    );
    expect(lbStmt, 'board-fn must have a Leaderboard DDB grant').toBeDefined();
    expect(actionList(lbStmt as Record<string, unknown>)).toEqual([
      'dynamodb:UpdateItem',
    ]);
    // No forbidden action ANYWHERE on the Leaderboard for board-fn.
    const forbidden = [
      'dynamodb:Scan',
      'dynamodb:Query',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:*',
    ];
    for (const s of stmts) {
      if (!JSON.stringify(s.Resource).includes('Leaderboard')) continue;
      for (const a of actionList(s)) expect(forbidden).not.toContain(a);
    }
  });

  it('grants the shard-read actions (GetRecords/GetShardIterator/DescribeStream) on the Games STREAM ARN only', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'BoardFunctionRole');
    // The shard-read actions MUST be scoped to the StreamArn — never the table,
    // never "*". (ListStreams is the one platform-forced wildcard — see the
    // separate platform-honest pin below.)
    const shardActions = [
      'dynamodb:GetRecords',
      'dynamodb:GetShardIterator',
      'dynamodb:DescribeStream',
    ];
    const shardStmt = stmts.find((s) =>
      actionList(s).some((a) => shardActions.includes(a)),
    );
    expect(shardStmt, 'board-fn must have shard-read grants').toBeDefined();
    const resJson = JSON.stringify(shardStmt!.Resource);
    expect(resJson).toContain('StreamArn');
    expect(resJson).not.toBe('"*"');
    // Every action on that statement is a shard-read action — no table action.
    for (const a of actionList(shardStmt as Record<string, unknown>)) {
      expect([...shardActions, 'dynamodb:ListStreams']).toContain(a);
    }
  });

  it('platform-honest pin: ListStreams is the ONLY action permitted a "*" resource (DynamoDB list op cannot be ARN-scoped)', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'BoardFunctionRole');
    for (const s of stmts) {
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      if (!resources.includes('*')) continue;
      // A "*" resource is allowed ONLY when every action on that statement is
      // dynamodb:ListStreams (the list op DynamoDB does not scope to an ARN).
      for (const a of actionList(s)) {
        expect(a).toBe('dynamodb:ListStreams');
      }
    }
  });

  it('has NO grant against the Games TABLE (it reads the stream, not the table)', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'BoardFunctionRole');
    for (const s of stmts) {
      const resJson = JSON.stringify(s.Resource);
      if (resJson.includes('StreamArn')) continue; // stream grant — allowed.
      if (resJson === '"*"') continue; // ListStreams platform wildcard — allowed.
      // Any remaining statement must target Leaderboard (the only other DDB grant).
      expect(resJson).toContain('Leaderboard');
    }
  });

  it('the whole board-fn role has no dynamodb:* wildcard ACTION', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'BoardFunctionRole');
    for (const s of stmts) {
      for (const a of actionList(s)) expect(a).not.toBe('dynamodb:*');
    }
  });
});

describe('s009 — oxo-game-fn gains EXACTLY Scan on Leaderboard (AC3.7, T-LB-9)', () => {
  it('grants dynamodb:Scan on the Leaderboard ARN only — no other Leaderboard action', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'GameFunctionServiceRole');
    const lbStmt = stmts.find((s) =>
      JSON.stringify(s.Resource).includes('Leaderboard'),
    );
    expect(lbStmt, 'game-fn must have a Leaderboard Scan grant').toBeDefined();
    expect(actionList(lbStmt as Record<string, unknown>)).toEqual(['dynamodb:Scan']);
  });

  it('grants NO Query/UpdateItem/DeleteItem/GetItem/PutItem on Leaderboard for game-fn', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'GameFunctionServiceRole');
    const forbidden = [
      'dynamodb:Query',
      'dynamodb:UpdateItem',
      'dynamodb:DeleteItem',
      'dynamodb:GetItem',
      'dynamodb:PutItem',
    ];
    for (const s of stmts) {
      if (!JSON.stringify(s.Resource).includes('Leaderboard')) continue;
      for (const a of actionList(s)) expect(forbidden).not.toContain(a);
    }
  });

  it('leaves the existing Games/Codes PutItem grants UNCHANGED (still present)', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'GameFunctionServiceRole');
    // There must still be PutItem statements (Games + Codes) — no regression.
    const putStmts = stmts.filter((s) => actionList(s).includes('dynamodb:PutItem'));
    expect(putStmts.length).toBeGreaterThanOrEqual(2);
  });
});

describe('s009 — oxo-ws-fn gains NOTHING (T-LB-9, AC5.12)', () => {
  it('the ws-fn role has NO Leaderboard grant of any kind', () => {
    const template = synth();
    const stmts = ddbStatementsForRole(template, 'WsFunctionRole');
    for (const s of stmts) {
      expect(JSON.stringify(s.Resource)).not.toContain('Leaderboard');
    }
  });
});
