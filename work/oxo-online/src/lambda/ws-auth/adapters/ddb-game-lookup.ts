import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { GameLookupPort } from '../ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * ddb-game-lookup.ts — ADAPTER. Implements GameLookupPort by Querying the
 * Games `code-index` GSI for the join code. Read-only Query (CP-H2-A): never
 * Scan, never a write command — matching the authorizer role's granted set.
 * Maps the first matching item → { status } or null. §41 taxonomy + logging.
 */

export interface DdbGameLookupDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  indexName: string;
  buildSha: string;
  log: LogFn;
}

export class DdbGameLookup implements GameLookupPort {
  constructor(private readonly deps: DdbGameLookupDeps) {}

  async findByCode(code: string): Promise<{ status: string } | null> {
    try {
      const out = await this.deps.client.send(
        new QueryCommand({
          TableName: this.deps.tableName,
          IndexName: this.deps.indexName,
          KeyConditionExpression: '#code = :code',
          ExpressionAttributeNames: { '#code': 'code' },
          ExpressionAttributeValues: { ':code': code },
          Limit: 1,
        }),
      );
      const item = out.Items?.[0];
      if (!item) return null;
      return { status: item.status as string };
    } catch (err) {
      this.deps.log({
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Games.findByCode',
      });
      throw err;
    }
  }
}
