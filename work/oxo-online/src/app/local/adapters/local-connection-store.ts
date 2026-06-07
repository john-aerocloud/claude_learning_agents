import type {
  ConnectionBinding,
  ConnectionRole,
  ConnectionStorePort,
} from '../../../lambda/move/ports';

/**
 * LocalConnectionStore — in-memory ConnectionStorePort for the s007 local
 * stand-up (UC1-S6, principles/02). Implements the SAME domain-defined port the
 * DynamoDB adapter (UC1-S4 DdbConnectionStore) implements, so the $disconnect
 * resolve-step (connectionId → gameId/role) stands up locally behind the same
 * seam (§41) with no cloud creds.
 *
 * getConnection is a single primary-key read of the connection's OWN row (S1:
 * connectionId IS the identity — no Query/Scan, no cross-game enumeration).
 */
export class LocalConnectionStore implements ConnectionStorePort {
  private connections = new Map<string, ConnectionBinding>();

  /** Bind a connection to its game+role (server-derived; local-server bootstrap). */
  put(args: { connectionId: string; gameId: string; role: ConnectionRole }): void {
    this.connections.set(args.connectionId, { gameId: args.gameId, role: args.role });
  }

  async getConnection(connectionId: string): Promise<ConnectionBinding | null> {
    const b = this.connections.get(connectionId);
    return b ? { ...b } : null;
  }

  async deleteConnection(connectionId: string): Promise<void> {
    this.connections.delete(connectionId);
  }
}
