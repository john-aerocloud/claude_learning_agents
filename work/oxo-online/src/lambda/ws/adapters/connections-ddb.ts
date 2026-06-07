import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  ConnectionBinding,
  ConnectionRole,
  ConnectionStorePort,
} from '../../move/ports';
import { categoriseDdbError, type LogFn } from './failure';

/**
 * connections-ddb.ts — ADAPTER implementing ConnectionStorePort over DynamoDB
 * (§41). Two operations on the Connections table:
 *   - getConnection: GetItem on the connection's OWN primary key (S1 — single
 *     read, no Query/Scan, cannot enumerate other games' rows) → { gameId, role }.
 *   - deleteConnection: DeleteItem (best-effort row removal; the 2h TTL backstops).
 *
 * Code↔policy pin (§30 / S5): this adapter issues ONLY GetItem (the UC2-granted
 * read) + DeleteItem (the s005 grant) against the Connections table — NEVER
 * Query/Scan/Put/Update. The test asserts no ungranted command type is ever
 * issued so least-privilege and code cannot silently diverge into a prod
 * AccessDenied. Failure taxonomy: a DDB 5xx after SDK backoff is logged
 * EXTERNAL_DEPENDENCY (availability); a 4xx is INTERNAL (our defect signal).
 */

export interface DdbConnectionStoreDeps {
  client: DynamoDBDocumentClient;
  tableName: string;
  buildSha: string;
  log: LogFn;
}

export class DdbConnectionStore implements ConnectionStorePort {
  constructor(private readonly deps: DdbConnectionStoreDeps) {}

  async getConnection(connectionId: string): Promise<ConnectionBinding | null> {
    try {
      const out = await this.deps.client.send(
        new GetCommand({
          TableName: this.deps.tableName,
          Key: { connectionId },
        }),
      );
      const item = out.Item;
      if (!item || typeof item.gameId !== 'string') return null;
      return {
        gameId: item.gameId as string,
        role: item.role as ConnectionRole,
      };
    } catch (err) {
      this.deps.log({
        event: 'connection_read_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Connections.getConnection',
      });
      throw err;
    }
  }

  async deleteConnection(connectionId: string): Promise<void> {
    try {
      await this.deps.client.send(
        new DeleteCommand({
          TableName: this.deps.tableName,
          Key: { connectionId },
        }),
      );
    } catch (err) {
      // Best-effort: a delete failure is logged; the 2h Connections TTL is the
      // backstop. The handler also catches this — it never aborts the flow.
      this.deps.log({
        event: 'connection_delete_failed',
        buildSha: this.deps.buildSha,
        category: categoriseDdbError(err),
        op: 'Connections.deleteConnection',
      });
      throw err;
    }
  }
}
