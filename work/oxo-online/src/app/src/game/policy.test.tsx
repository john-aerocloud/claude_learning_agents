import { describe, it, expect, vi, afterEach } from 'vitest';
import { initialState, applyMove, type GameState } from './engine';
import { bestMove } from './ai';

// Vite-native raw import of every source file under src/game/. Avoids node:*
// imports (and a new @types/node dependency) entirely.
const gameSources = import.meta.glob('./*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// D1 — no dangerous HTML sink anywhere in the game UI (S1).
describe('policy: no dangerouslySetInnerHTML in src/game (D1, S1)', () => {
  it('never appears in any non-test game source file', () => {
    const sourceFiles = Object.entries(gameSources).filter(
      ([path]) => !/\.test\.tsx?$/.test(path),
    );
    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const [path, src] of sourceFiles) {
      expect(
        src,
        `${path} must not use dangerouslySetInnerHTML`,
      ).not.toContain('dangerouslySetInnerHTML');
    }
  });
});

// D2 — the cell value set is closed to {'X','O',null} (S1).
describe('policy: cell values are closed to {X,O,null} (D2, S1)', () => {
  it('admits no other value after an exhaustive legal play-out', () => {
    const allowed = new Set<unknown>(['X', 'O', null]);
    // Depth-first over every legal move sequence from the start.
    const seen: GameState[] = [];
    const visit = (s: GameState) => {
      seen.push(s);
      if (s.status !== 'playing') return;
      for (let i = 0; i < 9; i += 1) {
        if (s.board[i] === null) visit(applyMove(s, i));
      }
    };
    visit(initialState());
    for (const s of seen) {
      for (const cell of s.board) {
        expect(allowed.has(cell)).toBe(true);
      }
    }
  });
});

// D3 — no outbound game-state network call during gameplay (T1, S2).
// s009 UC3 (flag factored out, §40): the idle view performs ONE sanctioned READ
// — GET /api/leaderboard — on mount and on return-to-idle. The control this
// policy protects is unchanged: local gameplay issues no game-state I/O, no XHR,
// and NEVER opens a WebSocket. Any fetch must be the read-only leaderboard GET.
describe('policy: gameplay performs no game-state network I/O (D3, T1, S2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('only the read-only /api/leaderboard GET fires; no XHR, no WebSocket across moves, win, and reset', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const { GameRoot } = await import('./GameRoot');

    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );
    const xhrOpen = vi.fn();
    const wsCtor = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    class FakeXHR {
      open = xhrOpen;
      send = vi.fn();
      setRequestHeader = vi.fn();
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    vi.stubGlobal(
      'WebSocket',
      function WS(this: unknown, url: string) {
        wsCtor(url);
      } as unknown as typeof WebSocket,
    );

    render(<GameRoot />);
    // Play to an X win, then reset, then play one more move.
    for (const i of [0, 3, 1, 4, 2]) {
      await userEvent.click(screen.getByLabelText(`cell ${i}`));
    }
    await userEvent.click(screen.getByRole('button', { name: /play again/i }));
    await userEvent.click(screen.getByLabelText('cell 8'));

    // The ONLY permitted fetch is the read-only leaderboard GET (idle view).
    for (const call of fetchSpy.mock.calls) {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
      expect(url, `unexpected fetch to ${url}`).toContain('/api/leaderboard');
    }
    // No game-state writes (POST /api/games), no XHR, no WebSocket in local play.
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(wsCtor).not.toHaveBeenCalled();
    cleanup();
  });
});

// D4 — no game-state network during a full vs-Computer game (T5, S3).
// As D3: the idle view's read-only /api/leaderboard GET is the only permitted
// fetch; vs-Computer play opens no socket and writes no game state.
describe('policy: vs-Computer play performs no game-state network I/O (D4, T5, S3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('only the read-only /api/leaderboard GET fires; no XHR, no WebSocket across AI moves and reset', async () => {
    const { render, screen, waitFor, cleanup } = await import(
      '@testing-library/react'
    );
    const userEvent = (await import('@testing-library/user-event')).default;
    const { GameRoot } = await import('./GameRoot');

    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );
    const xhrOpen = vi.fn();
    const wsCtor = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    class FakeXHR {
      open = xhrOpen;
      send = vi.fn();
      setRequestHeader = vi.fn();
    }
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    vi.stubGlobal(
      'WebSocket',
      function WS(this: unknown, url: string) {
        wsCtor(url);
      } as unknown as typeof WebSocket,
    );

    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /vs computer/i }),
    );
    // Play to a terminal state: human takes the first empty playable cell, AI
    // (optimal O) replies each turn. Loop until Play again appears.
    while (!screen.queryByRole('button', { name: /play again/i })) {
      let clicked = false;
      for (let i = 0; i < 9 && !clicked; i += 1) {
        const cell = screen.getByLabelText(`cell ${i}`);
        if (cell.textContent === '' && !(cell as HTMLButtonElement).disabled) {
          await userEvent.click(cell);
          clicked = true;
        }
      }
      await waitFor(() => {});
      if (!clicked) break;
    }
    await userEvent.click(
      screen.getByRole('button', { name: /play again/i }),
    );
    // One more human move after reset (AI replies).
    await userEvent.click(screen.getByLabelText('cell 0'));
    await waitFor(() => {});

    // The ONLY permitted fetch is the read-only leaderboard GET (idle view).
    for (const call of fetchSpy.mock.calls) {
      const url = typeof call[0] === 'string' ? call[0] : (call[0] as Request).url;
      expect(url, `unexpected fetch to ${url}`).toContain('/api/leaderboard');
    }
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(wsCtor).not.toHaveBeenCalled();
    cleanup();
  });
});

// D5 — closed value set holds with AI-produced O moves (S1).
describe('policy: cell values stay closed to {X,O,null} with AI play (D5, S1)', () => {
  it('admits no other value as optimal O answers every X line of play', () => {
    const allowed = new Set<unknown>(['X', 'O', null]);
    const assertClosed = (s: GameState) => {
      for (const cell of s.board) expect(allowed.has(cell)).toBe(true);
    };
    // Same game tree as ai A4: X branches over every legal move, O = bestMove.
    const walk = (s: GameState) => {
      assertClosed(s);
      if (s.status !== 'playing') return;
      if (s.currentPlayer === 'X') {
        for (let i = 0; i < 9; i += 1) {
          if (s.board[i] === null) walk(applyMove(s, i));
        }
      } else {
        walk(applyMove(s, bestMove(s)));
      }
    };
    walk(initialState());
  });
});
