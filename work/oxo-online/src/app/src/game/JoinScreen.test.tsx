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
