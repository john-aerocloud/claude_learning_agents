import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinScreen } from './JoinScreen';
import type { ConnectOptions, GameSocket, GameSocketFactory } from './socket';

/** A mock socket factory that captures the connect options + sent frames. */
function mockFactory() {
  const sent: unknown[] = [];
  let captured: ConnectOptions | null = null;
  const socket: GameSocket = {
    send: (frame) => sent.push(frame),
    close: vi.fn(),
  };
  const factory: GameSocketFactory = (opts) => {
    captured = opts;
    return socket;
  };
  return {
    factory,
    sent,
    socket,
    get opts() {
      return captured;
    },
  };
}

describe('JoinScreen — code input + submit + connecting indicator (B1, F3, F6)', () => {
  it('lets the player enter a 6-char code and submit it', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    const input = screen.getByLabelText(/game code/i);
    await userEvent.type(input, 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(m.sent).toContainEqual({ action: 'join', code: 'ABC234' });
  });

  it('shows a connecting indicator while the socket is pending', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(screen.getByTestId('join-connecting')).toBeInTheDocument();
  });

  it('retains the entered code after a (mocked) error frame', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    // DEFECT-005-001 Bug B: the server reports the failure via an error MESSAGE
    // frame (then DELETEs the socket); the code must still be retained for retry.
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4040,
        message: 'Game not found. Check the code and try again.',
      }),
    );
    expect(screen.getByLabelText(/game code/i)).toHaveValue('ABC234');
  });
});

describe('JoinScreen — error-frame messages (DEFECT-005-001 Bug B; B2, F3/F4/F9, S3)', () => {
  // Bug B: the codes now arrive as a {type:'error', code, message} MESSAGE
  // frame, NOT as a WS close code (which the platform cannot deliver). The UI
  // must render the SAME three messages, keyed off the error frame's code.
  const cases: Array<[number, string]> = [
    [4040, 'Game not found. Check the code and try again.'],
    [4041, 'This game is no longer available.'],
    [4500, 'Something went wrong. Please try again.'],
  ];

  it.each(cases)('renders the exact message for error code %i', async (code, message) => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    act(() => m.opts?.onMessage({ type: 'error', code, message }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    // Screen stays mounted + accessible; code retained.
    expect(screen.getByLabelText(/game code/i)).toHaveValue('ABC234');
    expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
  });

  it('clears the connecting indicator once an error frame arrives', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(screen.getByTestId('join-connecting')).toBeInTheDocument();
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4041,
        message: 'This game is no longer available.',
      }),
    );
    expect(screen.queryByTestId('join-connecting')).not.toBeInTheDocument();
  });

  it('falls back to the generic message on a bare close with no prior error frame (real disconnect)', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    // A real disconnect (e.g. network drop, or the server's DELETE close 1000)
    // with no preceding error frame degrades to the generic message.
    act(() => m.opts?.onClose(1006));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });

  it('a close AFTER an error frame does not overwrite the specific message', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4040,
        message: 'Game not found. Check the code and try again.',
      }),
    );
    // The server then DELETEs the connection -> onClose(1000). The already-shown
    // specific message must remain (the error frame is authoritative).
    act(() => m.opts?.onClose(1000));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Game not found. Check the code and try again.',
    );
  });
});
