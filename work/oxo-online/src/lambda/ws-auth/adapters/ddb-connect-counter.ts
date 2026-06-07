import {
  DynamoDBDocumentClient,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ConnectCounterPort } from '../ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * ddb-connect-counter.ts — ADAPTER. Implements ConnectCounterPort over a single
 * DynamoDB UpdateItem: atomic `ADD count :one` plus a first-write-only TTL
 * (`if_not_exists(ttl, :ttl)`). Returns the post-increment count.
 *
 * Code↔policy pin (CP-H2-B): this adapter issues ONLY UpdateItem against the
 * ConnectAttempts table — no Get/Scan/Put/Delete — matching the granted action
 * set on the authorizer role. Failure taxonomy (§41): a 5xx/timeout from
 * DynamoDB is EXTERNAL_DEPENDENCY (availability); a 4xx is INTERNAL (our bad
 * request). Both are logged with category + buildSha and rethrown.
 */

export interface DdbConnectCounterDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  ttlSeconds: number;
  now: () => number;
  buildSha: string;
  log: LogFn;
}

export class DdbConnectCounter implements ConnectCounterPort {
  constructor(private readonly deps: DdbConnectCounterDeps) {}

  async increment(sourceIp: string): Promise<number> {
    const ttl = this.deps.now() + this.deps.ttlSeconds;
    try {
      const out = await this.deps.client.send(
        new UpdateCommand({
          TableName: this.deps.tableName,
          Key: { sourceIp },
          UpdateExpression:
            'ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)',
          ExpressionAttributeNames: { '#count': 'count', '#ttl': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':ttl': ttl },
          ReturnValues: 'UPDATED_NEW',
        }),
      );
      return (out.Attributes?.count as number) ?? 0;
    } catch (err) {
      const category = categoriseDdbError(err);
      this.deps.log({
        buildSha: this.deps.buildSha,
        category,
        op: 'ConnectAttempts.increment',
        sourceIp,
      });
      throw err;
    }
  }
}
