import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initialState, applyMove, type GameState } from './engine';

const gameDir = dirname(fileURLToPath(import.meta.url));

function gameSourceFiles(): string[] {
  return readdirSync(gameDir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => join(gameDir, f));
}

// D1 — no dangerous HTML sink anywhere in the game UI (S1).
describe('policy: no dangerouslySetInnerHTML in src/game (D1, S1)', () => {
  it('never appears in any game source file', () => {
    for (const file of gameSourceFiles()) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toContain('dangerouslySetInnerHTML');
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

// D3 — no outbound network call during gameplay (T1, S2).
describe('policy: gameplay performs no network I/O (D3, T1, S2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('never invokes fetch, XHR, or WebSocket across moves, win, and reset', async () => {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const userEvent = (await import('@testing-library/user-event')).default;
    const { GameRoot } = await import('./GameRoot');

    const fetchSpy = vi.fn();
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

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(wsCtor).not.toHaveBeenCalled();
    cleanup();
  });
});
