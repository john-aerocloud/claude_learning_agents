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

  it('retains the entered code after a (mocked) close event', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    // Server closes the socket.
    act(() => m.opts?.onClose(4040));
    expect(screen.getByLabelText(/game code/i)).toHaveValue('ABC234');
  });
});

describe('JoinScreen — close-code error messages (B2, F3/F4/F9, S3)', () => {
  const cases: Array<[number, string]> = [
    [4040, 'Game not found. Check the code and try again.'],
    [4041, 'This game is no longer available.'],
    [4500, 'Something went wrong. Please try again.'],
  ];

  it.each(cases)('renders the exact message for close code %i', async (code, message) => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    act(() => m.opts?.onClose(code));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    // Screen stays mounted + accessible; code retained.
    expect(screen.getByLabelText(/game code/i)).toHaveValue('ABC234');
    expect(screen.getByRole('button', { name: /join/i })).toBeInTheDocument();
  });

  it('clears the connecting indicator once a close arrives', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(screen.getByTestId('join-connecting')).toBeInTheDocument();
    act(() => m.opts?.onClose(4041));
    expect(screen.queryByTestId('join-connecting')).not.toBeInTheDocument();
  });

  it('maps an unexpected close code to the generic message (no leak)', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    act(() => m.opts?.onClose(1006));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });
});
