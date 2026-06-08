import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameRoot } from './GameRoot';
import type { ConnectOptions, GameSocket, GameSocketFactory } from './socket';

/** Capture the latest ConnectOptions so a test can drive game-ready/close. */
function captureFactory() {
  const sent: unknown[] = [];
  let captured: ConnectOptions | null = null;
  const close = vi.fn();
  const socket: GameSocket = { send: (f) => sent.push(f), close };
  const factory: GameSocketFactory = (opts) => {
    captured = opts;
    return socket;
  };
  return {
    factory,
    sent,
    close,
    get opts() {
      return captured;
    },
  };
}

/**
 * Spy on global fetch, routing GET /api/leaderboard to a fresh empty-leaderboard
 * Response and every other call (the POST /api/games create) to a FRESH Response
 * built from `gamesBody` per invocation. A fresh Response per call is essential:
 * the leaderboard fetch (unconditional on idle mount, §40) and the create POST
 * both read the body, and a Response body can only be consumed once. Returns the
 * spy so call-sites can assert on the /api/games invocation (filtered by URL).
 */
function mockGamesFetch(gamesBody: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/leaderboard')) {
      return Promise.resolve(
        new Response(JSON.stringify({ entries: [], buildSha: 'test' }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify(gamesBody), { status: 201 }));
  });
}

/** The POST /api/games calls captured by a fetch spy (leaderboard calls excluded). */
function gamesCalls(spy: { mock: { calls: unknown[][] } }) {
  return (spy.mock.calls as Array<[unknown, RequestInit?]>).filter(([input]) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    return url.includes('/api/games');
  });
}

/** Count rendered cells currently holding a given symbol. */
function countSymbol(symbol: 'X' | 'O'): number {
  let n = 0;
  for (let i = 0; i < 9; i += 1) {
    if (screen.getByLabelText(`cell ${i}`).textContent === symbol) n += 1;
  }
  return n;
}

describe('GameRoot — placing a symbol (B4)', () => {
  it('shows X in the cell that the first move clicks', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
  });
});

describe('GameRoot — turn alternation in the UI (B5)', () => {
  it("reads X's turn, then O's turn, then X's turn as play proceeds", async () => {
    render(<GameRoot />);
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(screen.getByTestId('game-status')).toHaveTextContent("O's turn");
    await userEvent.click(screen.getByLabelText('cell 1'));
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
  });
});

describe('GameRoot — clicking a taken cell is a no-op (B6)', () => {
  it('leaves the symbol and the turn unchanged', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X, now O's turn
    expect(screen.getByLabelText('cell 0')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('cell 0')); // ignored
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    expect(screen.getByTestId('game-status')).toHaveTextContent("O's turn");
  });
});

async function clickCells(indices: number[]) {
  for (const i of indices) {
    await userEvent.click(screen.getByLabelText(`cell ${i}`));
  }
}

describe('GameRoot — win locks the board and shows result (B7)', () => {
  it('announces the winner and disables remaining empty cells', async () => {
    render(<GameRoot />);
    // X: 0,1,2 (row 0 win) ; O: 3,4
    await clickCells([0, 3, 1, 4, 2]);
    expect(screen.getByTestId('game-status')).toHaveTextContent('X wins');
    // cell 5 is still empty but the board is locked
    expect(screen.getByLabelText('cell 5')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('cell 5'));
    expect(screen.getByLabelText('cell 5')).toHaveTextContent('');
  });
});

describe('GameRoot — draw shows Draw (B8)', () => {
  it('announces a draw when the board fills with no line', async () => {
    render(<GameRoot />);
    // Fills board with no winning line (see engine A7).
    await clickCells([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(screen.getByTestId('game-status')).toHaveTextContent('Draw');
  });
});

describe('GameRoot — Play again resets (B9)', () => {
  it('is hidden while playing', () => {
    render(<GameRoot />);
    expect(
      screen.queryByRole('button', { name: /play again/i }),
    ).not.toBeInTheDocument();
  });

  it('clears the board and returns to X’s turn after a finished game', async () => {
    render(<GameRoot />);
    await clickCells([0, 3, 1, 4, 2]); // X wins
    await userEvent.click(
      screen.getByRole('button', { name: /play again/i }),
    );
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
    // A fresh move can be played.
    await userEvent.click(screen.getByLabelText('cell 8'));
    expect(screen.getByLabelText('cell 8')).toHaveTextContent('X');
  });
});

describe('GameRoot — mode selector (B1, S1, F1)', () => {
  it('offers a vs Computer control and defaults to two-player', () => {
    render(<GameRoot />);
    expect(
      screen.getByRole('button', { name: /vs computer/i }),
    ).toBeInTheDocument();
    // Default unchanged: empty board, X to move.
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
  });
});

describe('GameRoot — selecting vs Computer (B2, F1)', () => {
  it('starts a fresh game with the human as X', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
  });
});

describe('GameRoot — switching mode resets the board (B3)', () => {
  it('clears an in-progress two-player game when vs Computer is chosen', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X plays
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('');
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
  });
});

describe('GameRoot — AI plays O automatically (C1, F2)', () => {
  it('places exactly one O after the human X move with no further input', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    await userEvent.click(screen.getByLabelText('cell 0')); // human X
    await waitFor(() => expect(countSymbol('O')).toBe(1));
    expect(countSymbol('X')).toBe(1);
  });
});

describe('GameRoot — AI move renders within 200ms (C2, F3, T4)', () => {
  it('shows O quickly after the human move', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    const start = performance.now();
    await userEvent.click(screen.getByLabelText('cell 4')); // human X centre
    await waitFor(() => expect(countSymbol('O')).toBe(1));
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('GameRoot — Play again stays in vs-Computer mode (C3, F6)', () => {
  it('resets the board but keeps AI responding to the next human move', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    // Drive a full game to a terminal state against optimal O (ends in a draw
    // or O win — never an X win). Keep clicking the first empty cell as X.
    while (
      !screen.queryByRole('button', { name: /play again/i })
    ) {
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
    await userEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
    // Mode persisted: a fresh human X still triggers an automatic O reply.
    await userEvent.click(screen.getByLabelText('cell 0'));
    await waitFor(() => expect(countSymbol('O')).toBe(1));
  });
});

describe('GameRoot — two-player mode produces no auto-O (C4, F5, T7)', () => {
  it('leaves the board with only the human symbol in default mode', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X
    expect(countSymbol('X')).toBe(1);
    expect(countSymbol('O')).toBe(0);
    expect(screen.getByTestId('game-status')).toHaveTextContent("O's turn");
  });
});

describe('GameRoot — Play Online success flow (F1, F2, F3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues POST /api/games when Play Online is clicked', async () => {
    const fetchMock = mockGamesFetch({ gameId: 'g-1', code: 'ABC234' });
    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /play online/i }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a loading indicator while the request is pending', async () => {
    // Route the leaderboard GET to a resolved empty response so only the
    // /api/games POST stays pending (the loading state we assert on).
    let resolveFetch: (r: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/leaderboard')) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
      }
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /play online/i }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/starting|loading|waiting/i);
    // resolve so the component settles before the test ends
    resolveFetch(
      new Response(JSON.stringify({ gameId: 'g-1', code: 'ABC234' }), {
        status: 201,
      }),
    );
    await waitFor(() => expect(screen.getByText('ABC234')).toBeInTheDocument());
  });

  it('shows the returned code prominently and keeps it visible', async () => {
    mockGamesFetch({ gameId: 'g-1', code: 'MNP234' });
    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /play online/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('MNP234')).toBeInTheDocument();
    // Remains visible without further interaction.
    expect(screen.getByText('MNP234')).toBeVisible();
  });
});

describe('GameRoot — Play Online failure degrades gracefully (F4, F5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a readable error and keeps the mode selector usable on rejection', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /play online/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/could not start online game/i)).toBeInTheDocument(),
    );
    // Mode selector still present and usable — no white-screen.
    expect(
      screen.getByRole('button', { name: /two player/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /vs computer/i }),
    ).toBeInTheDocument();
    // Existing mode still works after the error.
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByTestId('game-status')).toHaveTextContent("X's turn");
  });

  it('shows a readable error on a 5xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/leaderboard')) {
        return Promise.resolve(new Response(JSON.stringify({ entries: [] }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'Could not create game' }), { status: 500 }),
      );
    });
    render(<GameRoot />);
    await userEvent.click(
      screen.getByRole('button', { name: /play online/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/could not start online game/i)).toBeInTheDocument(),
    );
    // The board is still present (mode selector accessible).
    expect(
      screen.getByRole('button', { name: /two player/i }),
    ).toBeInTheDocument();
  });
});

describe('GameRoot — Join a game flow (B4, F1)', () => {
  it('offers a "Join a game" control on the mode selector', () => {
    render(<GameRoot />);
    expect(
      screen.getByRole('button', { name: /join a game/i }),
    ).toBeInTheDocument();
  });

  it('opens the join screen with a code input when Join a game is clicked', async () => {
    render(<GameRoot socketFactory={captureFactory().factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    expect(screen.getByLabelText(/game code/i)).toBeInTheDocument();
  });

  it('transitions the joiner from connecting to the board with role O on game-ready', async () => {
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    // Server pairs the game.
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'guest', gameId: 'g-1' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are O');
    // The flag-out board is server-authoritative: the inert status line is gone,
    // replaced by the turn indicator (server says X to move first).
    expect(screen.getByTestId('online-turn')).toBeInTheDocument();
  });

  it('host shows a readable error (no white-screen) on a register error frame (DEFECT-005-001 Bug B)', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-9', code: 'ERR234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // The server reports a register failure via an error frame (Bug B).
    act(() =>
      cap.opts?.onMessage({
        type: 'error',
        code: 4500,
        message: 'Something went wrong. Please try again.',
      }),
    );
    // The host must not white-screen and must not reach the board.
    expect(screen.queryByTestId('online-role')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // The mode selector is still usable.
    expect(
      screen.getByRole('button', { name: /two player/i }),
    ).toBeInTheDocument();
  });

  it('transitions the host waiting screen to the board with role X on game-ready', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-1', code: 'HST234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // Host has opened the socket and registered; server pairs.
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: 'g-1' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are X');
  });
});

describe('GameRoot — real socket frames (C2, UC3, F1, F6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('host sends {action:register,gameId} when the waiting screen opens the socket', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-42', code: 'REG234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // The host registers the game it just created over the same seam.
    expect(cap.sent).toContainEqual({ action: 'register', gameId: 'g-42' });
  });

  it('joiner sends {action:join,code,playerName} when the join form is submitted', async () => {
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'JON234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    // s009 UC1 is unconditional (flag factored out, §40): the join frame always
    // carries the normalised playerName — the default "AAA" when the field is
    // untouched. (The named-guest case is pinned by AC1.5 below.)
    expect(cap.sent).toContainEqual({ action: 'join', code: 'JON234', playerName: 'AAA' });
  });
});

// T8 / UC3 / AC3.1 + UC4 / AC4.1: the SPA must thread the $connect credential
// through the socket seam — the host passes the create-game wsToken, the guest
// passes the entered code — so the factory builds the authorised wss URL.
describe('GameRoot — $connect credential threading (UC3/AC3.1, UC4/AC4.1, T8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('host passes the create-game wsToken as the connect credential (UC3/AC3.1)', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-7', code: 'TOK234', wsToken: 'host.tok.sig' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    expect(cap.opts?.credential).toEqual({ wsToken: 'host.tok.sig' });
  });

  it('host connects WITHOUT a credential when the create response omits wsToken (degraded mint, DEFECT-H2-001)', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-8', code: 'DEG234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // No wsToken minted -> host still connects, just without the param.
    expect(cap.opts?.credential).toBeUndefined();
  });

  it('guest passes the entered code as the connect credential (UC4/AC4.1)', async () => {
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'GST234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(cap.opts?.credential).toEqual({ code: 'GST234' });
  });
});

// s007 UC3 — survivor UX: an opponent-disconnected frame shows a message and
// returns the survivor to the mode selector WITHOUT a reload; the board goes
// inert; a late frame after game-over does NOT clobber the result.
// @covers spa-online-disconnect
describe('GameRoot — opponent-disconnected survivor UX (s007 UC3, F1, T2, AC3.1–AC3.3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Drive the host to the live online board and return the captured socket. */
  async function hostToBoard(cap: ReturnType<typeof captureFactory>) {
    mockGamesFetch({ gameId: 'g-dc', code: 'DSC234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: 'g-dc' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are X');
  }

  // AC3.1 — the exact pinned message text the tester's two-browser smoke keys off.
  it('AC3.1 — shows "Your opponent disconnected." on the opponent-disconnected frame', async () => {
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
    expect(screen.getByTestId('opponent-disconnected')).toHaveTextContent(
      'Your opponent disconnected.',
    );
    // Surfaced as an alert for assistive tech.
    expect(screen.getByRole('alert')).toHaveTextContent('Your opponent disconnected.');
  });

  // AC3.2 — the mode selector is rendered, with NO page reload.
  it('AC3.2 — returns to the mode selector without a window.location.reload', async () => {
    const reloadSpy = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload: reloadSpy },
    });
    try {
      const cap = captureFactory();
      await hostToBoard(cap);
      act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
      // The mode-selector root is present (stable aria-label group selector).
      expect(
        screen.getByRole('group', { name: /game mode/i }),
      ).toBeInTheDocument();
      // The online board is gone — the board is inert (no live game).
      expect(screen.queryByTestId('online-role')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/online game board/i)).not.toBeInTheDocument();
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: original,
      });
    }
  });

  // AC3.3 — the WS is closed after the frame is processed (no stale socket).
  it('AC3.3 — closes the WS socket after opponent-disconnected is processed', async () => {
    const cap = captureFactory();
    await hostToBoard(cap);
    cap.close.mockClear();
    act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
    expect(cap.close).toHaveBeenCalled();
  });

  // Requirement 2 — a late opponent-disconnected frame AFTER game-over must NOT
  // clobber the result screen: the result wins. The survivor already saw the
  // win/draw; a trailing disconnect frame is ignored.
  it('result wins: a late opponent-disconnected after game-over keeps the result screen', async () => {
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() => cap.opts?.onMessage({ type: 'game-over', result: 'X-wins' }));
    expect(screen.getByText(/x wins/i)).toBeInTheDocument();
    // A trailing disconnect frame arrives after the result.
    act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
    // The result screen still shows; no opponent-disconnected message clobbers it.
    expect(screen.getByText(/x wins/i)).toBeInTheDocument();
    expect(screen.queryByTestId('opponent-disconnected')).not.toBeInTheDocument();
  });
});

// s007 UC3-S3 — clean restart: from the disconnect screen the survivor can start
// a fresh online game in the SAME session. The old socket is closed cleanly and
// the new game gets a fresh connection with no residual state (F2, T6, AC3.4).
// @covers spa-online-disconnect
describe('GameRoot — clean Online restart after opponent disconnect (s007 UC3, F2, T6, AC3.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function hostToBoard(cap: ReturnType<typeof captureFactory>, code: string) {
    mockGamesFetch({ gameId: `g-${code}`, code });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: `g-${code}` }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are X');
  }

  it('AC3.4 — clicking Online after a disconnect starts a fresh create flow with no residual state', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'OLD234');
    // Old game made a move so there is residual board/gameId/socket.
    act(() =>
      cap.opts?.onMessage({
        type: 'board-update',
        board: 'X--------',
        currentTurn: 'O',
        status: 'active',
      }),
    );
    // Opponent disconnects — survivor lands on the disconnect screen.
    act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
    expect(screen.getByTestId('opponent-disconnected')).toBeInTheDocument();
    cap.close.mockClear();

    // The survivor starts a fresh online game. The create POST fires again
    // (fresh flow), and the new game opens a new socket via the gameId effect.
    const fetchMock = mockGamesFetch({ gameId: 'g-NEW234', code: 'NEW234' });
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // Fresh create POST issued (a new game, not a resumed one).
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games',
      expect.objectContaining({ method: 'POST' }),
    );
    // The new game code is shown; no residual board / online-role leaks through.
    expect(screen.getByText('NEW234')).toBeInTheDocument();
    expect(screen.queryByTestId('online-role')).not.toBeInTheDocument();
    expect(screen.queryByTestId('opponent-disconnected')).not.toBeInTheDocument();
    // The new game registers under its OWN gameId — no prior gameId leaks.
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: 'g-NEW234' }));
    await userEvent.click(screen.getByLabelText('cell 0'));
    // (game-ready set X to move on a fresh empty board; the move addresses the
    // NEW gameId — proving no prior gameId/board/socket leaked.)
    const moves = cap.sent.filter((f) => (f as { action?: string }).action === 'move');
    expect(moves[moves.length - 1]).toEqual({ action: 'move', gameId: 'g-NEW234', square: 0 });
  });
});

// s007 UC3-S4 — F4 regression: local two-player and vs-AI play to completion
// with NO regression from the disconnect wiring; the opponent-disconnected path
// (and its message) is never reached in these modes (AC3.5, AC3.6).
describe('GameRoot — local/AI modes unaffected by disconnect wiring (s007 UC3, F4, AC3.5, AC3.6)', () => {
  // AC3.5 — local two-player plays to a win, no disconnect message ever shows.
  it('AC3.5 — local two-player plays to a full win with no opponent-disconnected message', async () => {
    render(<GameRoot />);
    await clickCells([0, 3, 1, 4, 2]); // X wins top row
    expect(screen.getByTestId('game-status')).toHaveTextContent('X wins');
    expect(screen.queryByTestId('opponent-disconnected')).not.toBeInTheDocument();
  });

  // AC3.6 — vs-AI plays to completion, no disconnect message ever shows.
  it('AC3.6 — vs-AI plays to completion with no opponent-disconnected message', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    while (!screen.queryByRole('button', { name: /play again/i })) {
      let clicked = false;
      for (let i = 0; i < 9 && !clicked; i += 1) {
        const c = screen.getByLabelText(`cell ${i}`);
        if (c.textContent === '' && !(c as HTMLButtonElement).disabled) {
          await userEvent.click(c);
          clicked = true;
        }
      }
      await waitFor(() => {});
      if (!clicked) break;
    }
    expect(
      screen.getByRole('button', { name: /play again/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('opponent-disconnected')).not.toBeInTheDocument();
  });
});

describe('GameRoot — local modes unaffected by online wiring (B4, F8)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still offers Two player and vs Computer and completes a local game', async () => {
    render(<GameRoot />);
    expect(
      screen.getByRole('button', { name: /two player/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /vs computer/i }),
    ).toBeInTheDocument();
    // A local two-player game still plays to a win.
    await clickCells([0, 3, 1, 4, 2]);
    expect(screen.getByTestId('game-status')).toHaveTextContent('X wins');
  });
});

// UC4 (s006) — server-authoritative move relay, FLAG ON. The board sends `move`
// on click and renders STRICTLY from server broadcasts. @covers spa-online-move.
describe('GameRoot — UC4 online move relay (flag ON, AC4.1–AC4.4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { OXO_CONFIG?: unknown }).OXO_CONFIG;
  });

  // The s006 UC4 flag was factored out at slice delivery (§40): the move relay
  // is now unconditional, so enabling it is a no-op. Retained as a no-op so the
  // AC4.x test call-sites read unchanged; remove at the next touch.
  function flagOn() {
    /* flag factored out — move relay is the unconditional online behaviour */
  }

  /** Drive the host to the online board and return the captured socket opts. */
  async function hostToBoard(cap: ReturnType<typeof captureFactory>) {
    mockGamesFetch({ gameId: 'g-mv', code: 'MOV234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: 'g-mv' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are X');
  }

  // AC4.1 — clicking a square in online mode sends exactly one {action:'move'}.
  it('AC4.1 — host click on an empty square sends exactly one {action:"move", gameId, square}', async () => {
    flagOn();
    const cap = captureFactory();
    await hostToBoard(cap);
    // Server broadcasts the initial active board with X to move (host's turn).
    act(() =>
      cap.opts?.onMessage({
        type: 'board-update',
        board: '---------',
        currentTurn: 'X',
        status: 'active',
      }),
    );
    const before = cap.sent.filter((f) => (f as { action?: string }).action === 'move').length;
    await userEvent.click(screen.getByLabelText('cell 4'));
    const moves = cap.sent.filter((f) => (f as { action?: string }).action === 'move');
    expect(moves.length).toBe(before + 1);
    // GATE-AMEND: the move frame carries the gameId the game-ready frame supplied
    // (the SPA's single consistent source of gameId), used by the handler as the
    // non-trusted GetItem lookup key.
    expect(moves[moves.length - 1]).toEqual({ action: 'move', gameId: 'g-mv', square: 4 });
    // No optimistic update: cell 4 is still empty until the server broadcasts.
    expect(screen.getByLabelText('cell 4')).toHaveTextContent('');
  });

  // AC4.2 — render-on-broadcast with no prior click.
  it('AC4.2 — a board-update renders the server board + turn with no prior click', async () => {
    flagOn();
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() =>
      cap.opts?.onMessage({
        type: 'board-update',
        board: 'X--------',
        currentTurn: 'O',
        status: 'active',
      }),
    );
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    expect(screen.getByTestId('online-turn')).toHaveTextContent(/o/i);
  });

  // AC4.3 — board lock after game-over: clicks fire 0 sends.
  it('AC4.3 — after game-over, clicking any square sends no further move', async () => {
    flagOn();
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() =>
      cap.opts?.onMessage({
        type: 'board-update',
        board: 'XXX------',
        currentTurn: 'O',
        status: 'won',
      }),
    );
    act(() => cap.opts?.onMessage({ type: 'game-over', result: 'X-wins' }));
    const before = cap.sent.filter((f) => (f as { action?: string }).action === 'move').length;
    for (let i = 0; i < 9; i += 1) {
      await userEvent.click(screen.getByLabelText(`cell ${i}`));
    }
    const after = cap.sent.filter((f) => (f as { action?: string }).action === 'move').length;
    expect(after).toBe(before);
  });

  // AC4.4 — result screen rendering on game-over.
  it('AC4.4 — game-over result "X-wins" shows "X wins"', async () => {
    flagOn();
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() => cap.opts?.onMessage({ type: 'game-over', result: 'X-wins' }));
    expect(screen.getByText(/x wins/i)).toBeInTheDocument();
  });

  it('AC4.4 — game-over result "draw" shows "Draw"', async () => {
    flagOn();
    const cap = captureFactory();
    await hostToBoard(cap);
    act(() => cap.opts?.onMessage({ type: 'game-over', result: 'draw' }));
    expect(screen.getByText(/draw/i)).toBeInTheDocument();
  });

  // The guest path also relays moves: the guest's socket (owned by JoinScreen)
  // must be threaded up so a guest click sends `move` and broadcasts render.
  it('guest can send a move after game-ready (guest socket threaded to the move loop)', async () => {
    flagOn();
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'GMV234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    // GATE-AMEND: the guest joins by code and has no gameId client-side; it
    // learns the gameId from the game-ready frame and threads it into its moves.
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'guest', gameId: 'g-guest' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are O');
    // Server says it is O's turn (the guest's turn).
    act(() =>
      cap.opts?.onMessage({
        type: 'board-update',
        board: 'X--------',
        currentTurn: 'O',
        status: 'active',
      }),
    );
    await userEvent.click(screen.getByLabelText('cell 4'));
    expect(cap.sent).toContainEqual({ action: 'move', gameId: 'g-guest', square: 4 });
  });
});

// (s008's single copy-link control was REPLACED by the s009 UC4 two-control
// surface at §40 factor-out. Its S3 URL-form / "Copied!" / code-stays-visible
// assertions are now pinned by the UC4 two copy controls describe above
// (copy-link-btn). The single `copy-link` testid no longer exists.)

// s009 UC4 — TWO copy controls on the waiting screen (DEFECT-S008-002 closure),
// now the UNCONDITIONAL waiting-screen behaviour (flag factored out, §40): the
// single s008 copy-link is replaced by "Copy code" (copies the 6-char code) +
// "Copy link" (copies the /join/:code URL), each with a brief "Copied!"
// feedback; the code stays visible.
// @covers spa-copy-controls
describe('GameRoot — UC4 two copy controls (AC4.1/2/3/4, D1-5, A11Y-2)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function reachWaiting(code: string) {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-1', code });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    return cap;
  }

  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    return writeText;
  }

  it('AC4.1/D1 — the waiting screen shows BOTH "Copy code" and "Copy link" controls', async () => {
    await reachWaiting('ABC234');
    expect(screen.getByTestId('copy-code-btn')).toHaveAccessibleName(/copy code/i);
    expect(screen.getByTestId('copy-link-btn')).toHaveAccessibleName(/copy link/i);
    // The single s008 control is replaced (no longer present).
    expect(screen.queryByTestId('copy-link')).not.toBeInTheDocument();
  });

  it('AC4.2/D2 — "Copy code" copies the 6-char code, NOT the URL', async () => {
    const writeText = stubClipboard();
    await reachWaiting('ABC234');
    await userEvent.click(screen.getByTestId('copy-code-btn'));
    expect(writeText).toHaveBeenCalledWith('ABC234');
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).not.toContain('/join/');
    expect(copied).not.toContain('http');
  });

  it('AC4.3/D3 — "Copy link" copies origin + "/join/" + code, NOT the bare code', async () => {
    const writeText = stubClipboard();
    await reachWaiting('ABC234');
    await userEvent.click(screen.getByTestId('copy-link-btn'));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/ABC234`);
  });

  it('AC4.4/D4 — each control shows a "Copied!" confirmation after a write', async () => {
    stubClipboard();
    await reachWaiting('ABC234');
    await userEvent.click(screen.getByTestId('copy-code-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('copy-code-btn')).toHaveTextContent(/copied/i),
    );
    await userEvent.click(screen.getByTestId('copy-link-btn'));
    await waitFor(() =>
      expect(screen.getByTestId('copy-link-btn')).toHaveTextContent(/copied/i),
    );
  });

  it('the 6-char code stays visible after either copy', async () => {
    stubClipboard();
    await reachWaiting('ABC234');
    await userEvent.click(screen.getByTestId('copy-code-btn'));
    expect(screen.getByTestId('game-code')).toHaveTextContent('ABC234');
  });
});

// s009 UC1 — name entry (both parties), now UNCONDITIONAL (flag factored out,
// §40). The NameField sits ABOVE the mode buttons in the idle view, pre-filled
// from sessionStorage (else "AAA"), and is NEVER a gate — "Play Online"/"Join a
// game" stay enabled with an empty field (click-path BINDING). On create the
// normalised name rides POST /api/games {playerName}; on join it rides the WS
// join frame.
// @covers spa-name-field spa-name-wire
describe('GameRoot — UC1 name entry (AC1.1/1.2/1.6, A11Y-1/3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('AC1.1 — renders the "Your name" field on the idle view, pre-filled "AAA" when no session name', () => {
    render(<GameRoot />);
    const input = screen.getByRole('textbox', { name: 'Your name' });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('AAA');
  });

  it('AC1.1 — pre-fills from sessionStorage when a prior name exists', () => {
    sessionStorage.setItem('oxo.playerName', 'ZIP');
    render(<GameRoot />);
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('ZIP');
  });

  it('AC1.1 — the field renders ABOVE the mode buttons (focus/DOM order, A11Y-3)', () => {
    render(<GameRoot />);
    const input = screen.getByTestId('name-input');
    const playOnline = screen.getByRole('button', { name: /play online/i });
    // The name input precedes the Play Online button in DOM order.
    expect(
      input.compareDocumentPosition(playOnline) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('AC1.2 — Play Online / Join a game are ENABLED with an empty name (non-gating)', async () => {
    render(<GameRoot />);
    const input = screen.getByTestId('name-input');
    await userEvent.clear(input);
    expect(screen.getByRole('button', { name: /play online/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /join a game/i })).toBeEnabled();
  });
});

describe('GameRoot — UC1 name wire into create + join (AC1.3/1.4/1.6, T-LB-2/12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('AC1.3 — POST /api/games carries the normalised playerName (host)', async () => {
    const fetchMock = mockGamesFetch({ gameId: 'g-1', code: 'ABC234' });
    render(<GameRoot />);
    const input = screen.getByTestId('name-input');
    await userEvent.clear(input);
    await userEvent.type(input, 'ace');
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    // Filter to the /api/games POST (the leaderboard GET also fires on idle mount).
    const body = JSON.parse((gamesCalls(fetchMock)[0][1] as RequestInit).body as string);
    expect(body).toEqual({ playerName: 'ace' });
  });

  it('AC1.3 — an empty name posts "AAA" (default, no gate)', async () => {
    const fetchMock = mockGamesFetch({ gameId: 'g-1', code: 'ABC234' });
    render(<GameRoot />);
    await userEvent.clear(screen.getByTestId('name-input'));
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    const body = JSON.parse((gamesCalls(fetchMock)[0][1] as RequestInit).body as string);
    expect(body).toEqual({ playerName: 'AAA' });
  });

  it('AC1.6/T-LB-12 — a successful create persists the name to sessionStorage', async () => {
    mockGamesFetch({ gameId: 'g-1', code: 'ABC234' });
    render(<GameRoot />);
    await userEvent.clear(screen.getByTestId('name-input'));
    await userEvent.type(screen.getByTestId('name-input'), 'BEE');
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() => expect(sessionStorage.getItem('oxo.playerName')).toBe('BEE'));
  });

  it('AC1.5 — the WS join frame carries the normalised playerName (guest)', async () => {
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.clear(screen.getByTestId('name-input'));
    await userEvent.type(screen.getByTestId('name-input'), 'gus');
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(cap.sent).toContainEqual({ action: 'join', code: 'ABC234', playerName: 'gus' });
  });
});

// s009 UC3 — the shared leaderboard panel on the idle view, now UNCONDITIONAL
// (flag factored out, §40). It fetches GET /api/leaderboard on mount and renders
// loading → populated; it refetches when the player returns to idle from a game.
// @covers spa-leaderboard spa-leaderboard-client
describe('GameRoot — UC3 leaderboard panel (AC3.2, A11Y-12)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubLeaderboard(entries: unknown[]) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/leaderboard')) {
        return Promise.resolve(
          new Response(JSON.stringify({ entries, buildSha: 'sha9' }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ gameId: 'g-1', code: 'ABC234' }), { status: 201 }),
      );
    });
  }

  it('AC3.2 — fetches /api/leaderboard on mount and renders the populated table', async () => {
    stubLeaderboard([{ name: 'ACE', wins: 2, draws: 0, losses: 1 }]);
    render(<GameRoot />);
    await waitFor(() =>
      expect(screen.getByRole('table', { name: 'Leaderboard' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('leaderboard-name')).toHaveTextContent('ACE');
  });

  it('renders the panel below the board with an <h2> heading (A11Y-12)', async () => {
    stubLeaderboard([]);
    render(<GameRoot />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: /leaderboard/i })).toBeInTheDocument(),
    );
  });

  it('shows the error state on a failed fetch (graceful, no throw)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));
    render(<GameRoot />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load/i));
  });
});

// s014 UC2 — in-game chat wiring. The ChatPanel renders only on the active-game
// screen (playing-online + result undefined); a send dispatches {action:'chat',
// gameId, text} over the live socket; a chat-message frame appends to the
// in-memory list (own echo => "You", opponent => "Opponent"); the list clears on
// game-end and on opponent-disconnect. F3/F5, AC2.2.
// @covers spa-online-chat
describe('GameRoot — in-game chat wiring (s014 UC2, F3, F5)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Drive the host to the live online board and return the captured socket. */
  async function hostToBoard(cap: ReturnType<typeof captureFactory>, code: string) {
    mockGamesFetch({ gameId: `g-${code}`, code });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: `g-${code}` }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are X');
  }

  // AC2.2 (scope) — chat is ABSENT off the active-game screen.
  it('does NOT render the chat panel on the mode selector / idle screen', async () => {
    mockGamesFetch({ gameId: 'g-IDLE', code: 'IDL234' });
    render(<GameRoot />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /play online/i })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument();
  });

  it('does NOT render the chat panel on the waiting screen', async () => {
    const cap = captureFactory();
    mockGamesFetch({ gameId: 'g-W234', code: 'WAI234' });
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
  });

  // F5 / AC2.2 — chat is PRESENT on the active-game screen.
  it('renders the chat panel on the active-game (playing-online) screen', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'CHT234');
    expect(screen.getByRole('region', { name: 'Game chat' })).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    // The board geometry is untouched — the board region still resolves.
    expect(screen.getByLabelText('online game board')).toBeInTheDocument();
  });

  // Send path (SP-C1) — a submit dispatches a chat frame over the live socket.
  it('dispatches {action:chat, gameId, text} on send over the live socket', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'SND234');
    await userEvent.type(screen.getByTestId('chat-input'), 'good luck{Enter}');
    expect(cap.sent).toContainEqual({
      action: 'chat',
      gameId: 'g-SND234',
      text: 'good luck',
    });
  });

  // Receive path (SP-C4) — the sender's echo appears as "You"; an opponent relay
  // appears as "Opponent". The SPA renders on the echo frame (server-authoritative
  // — never optimistically on the local click).
  it('appends an echoed chat-message as "You" and an opponent relay as "Opponent"', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'RCV234');
    // The host (selfRole=host) sees its own echo labelled "You".
    act(() =>
      cap.opts?.onMessage({ action: 'chat-message', sender: 'host', text: 'gl hf' }),
    );
    // The opponent's relay (sender=guest) is labelled "Opponent".
    act(() =>
      cap.opts?.onMessage({ action: 'chat-message', sender: 'guest', text: 'you too' }),
    );
    const rows = within(screen.getByTestId('chat-messages')).getAllByTestId('chat-message');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId('chat-message-sender')).toHaveTextContent('You');
    expect(within(rows[0]).getByTestId('chat-message-text')).toHaveTextContent('gl hf');
    expect(within(rows[1]).getByTestId('chat-message-sender')).toHaveTextContent('Opponent');
  });

  // Graceful degradation — when the chat route is not live (no echo arrives), the
  // send simply produces no message and never crashes (empty-state stays).
  it('shows no message and does not crash when no echo arrives (route not live)', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'DEG234');
    await userEvent.type(screen.getByTestId('chat-input'), 'hello{Enter}');
    // The send went out, but with no echo back the list stays empty (no optimistic
    // render) — and the screen is still fully functional.
    expect(within(screen.getByTestId('chat-messages')).queryByTestId('chat-message')).toBeNull();
    expect(screen.getByText('No messages yet — say hi.')).toBeInTheDocument();
    expect(screen.getByLabelText('online game board')).toBeInTheDocument();
  });

  // Chat is gone after game-over (input absent; in-memory list cleared on session
  // end so a fresh game starts clean). Slice scope: "input is absent after
  // game-over".
  it('removes the chat input once a game-over frame arrives', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'END234');
    act(() => cap.opts?.onMessage({ action: 'chat-message', sender: 'host', text: 'hi' }));
    expect(within(screen.getByTestId('chat-messages')).getAllByTestId('chat-message')).toHaveLength(1);
    act(() => cap.opts?.onMessage({ type: 'game-over', result: 'X-wins' }));
    // Result shown; the chat input is no longer present (game no longer active).
    expect(screen.getByTestId('online-result')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-input')).not.toBeInTheDocument();
  });

  // On opponent-disconnect the session ends and the in-memory chat list is
  // cleared — a subsequent online game starts with an empty chat (no leak).
  it('clears the in-memory chat list when the online session ends (disconnect)', async () => {
    const cap = captureFactory();
    await hostToBoard(cap, 'CLR234');
    act(() => cap.opts?.onMessage({ action: 'chat-message', sender: 'guest', text: 'hi' }));
    act(() => cap.opts?.onMessage({ type: 'opponent-disconnected' }));
    expect(screen.getByTestId('opponent-disconnected')).toBeInTheDocument();
    // Start a fresh online game; the chat list must be empty (cleared on end).
    mockGamesFetch({ gameId: 'g-FR234', code: 'FRH234' });
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host', gameId: 'g-FR234' }));
    expect(within(screen.getByTestId('chat-messages')).queryByTestId('chat-message')).toBeNull();
  });
});
