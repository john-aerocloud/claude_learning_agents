import {
  AbandonConditionFailed,
  MoveConditionFailed,
  type GameState,
  type GameStorePort,
  type Role,
} from '../../../lambda/move/ports';

/**
 * LocalGameStore — in-memory GameStorePort for the UC5 local stand-up (OI-28).
 *
 * Implements the SAME domain-defined port the DynamoDB adapter (UC2) implements,
 * so the SPA move-relay loop stands up locally behind the same seam (§41). It
 * REPRODUCES the optimistic-lock (version-CAS) reject BRANCH: applyMoveWrite is a
 * compare-and-swap conditioned on (status='active', currentTurn=expectedTurn,
 * version=expectedVersion); a failed condition throws MoveConditionFailed and
 * makes NO partial write (reject-over-retry, §5a).
 *
 * Mocked-adapter caution (§12a): a JS map cannot reproduce real DynamoDB
 * conditional-write ATOMICITY under genuine concurrency — only the branch shape.
 * That platform guarantee is covered by the R2.6 ConditionExpression code-policy
 * pin + UC6 prod zero-divergence, NOT by this adapter.
 */
/** Local state = the port's GameState plus the winner the terminal write sets. */
type LocalState = GameState & { winner?: Role };

export class LocalGameStore implements GameStorePort {
  private games = new Map<string, LocalState>();

  /** Seed/replace a game (test + local-server bootstrap helper). */
  seed(game: GameState): void {
    this.games.set(game.gameId, { ...game });
  }

  async getGame(gameId: string): Promise<GameState | null> {
    const g = this.games.get(gameId);
    return g ? { ...g } : null;
  }

  /** Local-only read of the winner the terminal write recorded (server use). */
  winnerOf(gameId: string): Role | undefined {
    return this.games.get(gameId)?.winner;
  }

  async applyMoveWrite(args: {
    gameId: string;
    expectedVersion: number;
    expectedTurn: Role;
    patch: {
      board: string;
      nextTurn: Role;
      status?: GameState['status'];
      winner?: Role;
    };
  }): Promise<void> {
    const current = this.games.get(args.gameId);
    // The CAS condition: game must exist, be active, be on the expected turn,
    // and at the expected version. Any mismatch is a typed reject — NO write.
    if (
      !current ||
      current.status !== 'active' ||
      current.currentTurn !== args.expectedTurn ||
      current.version !== args.expectedVersion
    ) {
      throw new MoveConditionFailed();
    }

    // Single atomic apply: board/currentTurn/version+1/moveCount+1, plus the
    // terminal status/winner in the SAME write (no intermediate observable state).
    this.games.set(args.gameId, {
      ...current,
      board: args.patch.board,
      currentTurn: args.patch.nextTurn,
      version: current.version + 1,
      moveCount: current.moveCount + 1,
      ...(args.patch.status ? { status: args.patch.status } : {}),
      ...(args.patch.winner ? { winner: args.patch.winner } : {}),
    });
  }

  /**
   * $disconnect abandon (UC1-S6 local parity): flip active→abandoned conditioned
   * on `status === 'active'` (the local reproduction of the S2 CAS BRANCH — a JS
   * map cannot reproduce real DDB conditional atomicity, only the branch shape;
   * the platform guarantee is the ABANDON_CONDITION_EXPRESSION pin + UC4 prod).
   * A non-active game raises AbandonConditionFailed (swallowed by the handler).
   */
  async abandonGame(gameId: string): Promise<void> {
    const current = this.games.get(gameId);
    if (!current || current.status !== 'active') {
      throw new AbandonConditionFailed();
    }
    this.games.set(gameId, { ...current, status: 'abandoned' as GameState['status'] });
  }
}
