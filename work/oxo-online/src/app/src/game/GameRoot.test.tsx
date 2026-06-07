import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    await userEvent.click(screen.getByLabelText('cell 0'));
    expect(screen.getByRole('status')).toHaveTextContent("O's turn");
    await userEvent.click(screen.getByLabelText('cell 1'));
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
  });
});

describe('GameRoot — clicking a taken cell is a no-op (B6)', () => {
  it('leaves the symbol and the turn unchanged', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByLabelText('cell 0')); // X, now O's turn
    expect(screen.getByLabelText('cell 0')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('cell 0')); // ignored
    expect(screen.getByLabelText('cell 0')).toHaveTextContent('X');
    expect(screen.getByRole('status')).toHaveTextContent("O's turn");
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
    expect(screen.getByRole('status')).toHaveTextContent('X wins');
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
    expect(screen.getByRole('status')).toHaveTextContent('Draw');
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
    for (let i = 0; i < 9; i += 1) {
      expect(screen.getByLabelText(`cell ${i}`)).toHaveTextContent('');
    }
  });
});

describe('GameRoot — selecting vs Computer (B2, F1)', () => {
  it('starts a fresh game with the human as X', async () => {
    render(<GameRoot />);
    await userEvent.click(screen.getByRole('button', { name: /vs computer/i }));
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
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
    expect(screen.getByRole('status')).toHaveTextContent("O's turn");
  });
});

describe('GameRoot — Play Online success flow (F1, F2, F3)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('issues POST /api/games when Play Online is clicked', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ gameId: 'g-1', code: 'ABC234' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      );
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
    let resolveFetch: (r: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-1', code: 'MNP234' }), {
        status: 201,
      }),
    );
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
    expect(screen.getByRole('status')).toHaveTextContent("X's turn");
  });

  it('shows a readable error on a 5xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Could not create game' }), {
        status: 500,
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-9', code: 'ERR234' }), {
        status: 201,
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-1', code: 'HST234' }), {
        status: 201,
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-42', code: 'REG234' }), {
        status: 201,
      }),
    );
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    // The host registers the game it just created over the same seam.
    expect(cap.sent).toContainEqual({ action: 'register', gameId: 'g-42' });
  });

  it('joiner sends {action:join,code} when the join form is submitted', async () => {
    const cap = captureFactory();
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /join a game/i }));
    await userEvent.type(screen.getByLabelText(/game code/i), 'JON234');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(cap.sent).toContainEqual({ action: 'join', code: 'JON234' });
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ gameId: 'g-7', code: 'TOK234', wsToken: 'host.tok.sig' }),
        { status: 201 },
      ),
    );
    render(<GameRoot socketFactory={cap.factory} />);
    await userEvent.click(screen.getByRole('button', { name: /play online/i }));
    await waitFor(() =>
      expect(screen.getByText(/waiting for opponent/i)).toBeInTheDocument(),
    );
    expect(cap.opts?.credential).toEqual({ wsToken: 'host.tok.sig' });
  });

  it('host connects WITHOUT a credential when the create response omits wsToken (degraded mint, DEFECT-H2-001)', async () => {
    const cap = captureFactory();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-8', code: 'DEG234' }), {
        status: 201,
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-dc', code: 'DSC234' }), {
        status: 201,
      }),
    );
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: `g-${code}`, code }), { status: 201 }),
    );
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
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ gameId: 'g-NEW234', code: 'NEW234' }), {
          status: 201,
        }),
      );
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
    expect(screen.getByRole('status')).toHaveTextContent('X wins');
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
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ gameId: 'g-mv', code: 'MOV234' }), {
        status: 201,
      }),
    );
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
