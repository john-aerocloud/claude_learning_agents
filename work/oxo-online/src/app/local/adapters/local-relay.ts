import type { RelayPort } from '../../../lambda/move/ports';

/** A recorded relay post (for the S4 amplification-bound assertions). */
export interface RecordedPost {
  connectionIds: string[];
  message: unknown;
}

/** A sink that pushes a frame to one connection (the local WS server wires it). */
export type ConnectionSink = (message: unknown) => void;

/**
 * LocalRelay — in-process RelayPort for the UC5 local stand-up (OI-28).
 *
 * Implements the SAME domain-defined RelayPort the @connections adapter (UC3)
 * implements. It RECORDS every post so the relay-amplification-bound assertions
 * (S4: exactly 2 posts on an accepted non-terminal move, 1 on a reject) run
 * locally, AND forwards each post to a per-connection sink so the local WS server
 * can deliver the frame to the right browser. A post to an unregistered
 * connection is recorded but dropped (best-effort posture — no per-post retry,
 * matching the s006 delta; recovery deferred to s007).
 */
export class LocalRelay implements RelayPort {
  readonly posts: RecordedPost[] = [];
  private sinks = new Map<string, ConnectionSink>();

  /** Total individual deliveries across all posts (one per connection). */
  get postCount(): number {
    return this.posts.reduce((n, p) => n + p.connectionIds.length, 0);
  }

  /** Register a per-connection delivery sink (the local WS server wires it). */
  register(connectionId: string, sink: ConnectionSink): void {
    this.sinks.set(connectionId, sink);
  }

  /** Remove a connection's sink (on socket close). */
  unregister(connectionId: string): void {
    this.sinks.delete(connectionId);
  }

  async postToConnections(connectionIds: string[], message: unknown): Promise<void> {
    this.posts.push({ connectionIds: [...connectionIds], message });
    for (const id of connectionIds) {
      const sink = this.sinks.get(id);
      // Best-effort: a missing sink (connection gone) is dropped, not retried.
      if (sink) sink(message);
    }
  }
}
