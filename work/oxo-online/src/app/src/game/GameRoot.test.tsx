import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameRoot } from './GameRoot';
import type { ConnectOptions, GameSocket, GameSocketFactory } from './socket';

/** Capture the latest ConnectOptions so a test can drive game-ready/close. */
function captureFactory() {
  const sent: unknown[] = [];
  let captured: ConnectOptions | null = null;
  const socket: GameSocket = { send: (f) => sent.push(f), close: vi.fn() };
  const factory: GameSocketFactory = (opts) => {
    captured = opts;
    return socket;
  };
  return {
    factory,
    sent,
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
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'guest' }));
    expect(screen.getByTestId('online-role')).toHaveTextContent('You are O');
    expect(
      screen.getByText('Game active — moves coming in the next update'),
    ).toBeInTheDocument();
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
    act(() => cap.opts?.onMessage({ type: 'game-ready', role: 'host' }));
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
