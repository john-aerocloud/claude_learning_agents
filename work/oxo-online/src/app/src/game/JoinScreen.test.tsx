import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
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

  it('passes the entered code as the connect credential (UC4/AC4.1, T8)', async () => {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    await userEvent.type(screen.getByLabelText(/game code/i), 'ABC234');
    await userEvent.click(screen.getByRole('button', { name: /join/i }));
    // The factory appends `?code=` to the wss URL from this credential so the
    // deployed $connect authorizer can run the GSI lookup.
    expect(m.opts?.credential).toEqual({ code: 'ABC234' });
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
    vi.useFakeTimers();
    try {
      const m = mockFactory();
      render(<JoinScreen connect={m.factory} />);
      // fireEvent is synchronous — no userEvent timer waits under fake timers.
      fireEvent.change(screen.getByLabelText(/game code/i), {
        target: { value: 'ABC234' },
      });
      fireEvent.click(screen.getByRole('button', { name: /join/i }));
      // A CLEAN close (the server's DELETE close 1000) with no preceding error
      // frame degrades to the generic message — but only AFTER the grace window
      // elapses with no error frame arriving (Issue 2). (An ABNORMAL 1006 close
      // is the OI-33 code-not-found signal — covered in its own describe below.)
      act(() => m.opts?.onClose(1000));
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong. Please try again.',
      );
    } finally {
      vi.useRealTimers();
    }
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

// DEFECT-005-001-R2 (Issue 2, CLIENT half — the robust one). The browser can
// surface the DELETE-driven CLOSE event before the in-flight error MESSAGE
// event. On a close with NO prior error frame the screen must HOLD a short
// grace window for an in-flight error frame; if one arrives it wins (specific
// message), otherwise the generic message renders after the window. An
// authoritative error frame ALWAYS wins, regardless of ordering.
describe('JoinScreen — error-frame vs close race grace window (DEFECT-005-001-R2 Issue 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function submit() {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    // fireEvent is synchronous — no userEvent timer waits under fake timers.
    fireEvent.change(screen.getByLabelText(/game code/i), {
      target: { value: 'ABC234' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    return m;
  }

  it('close-then-message-within-grace: the specific error frame still wins', async () => {
    const m = submit();
    // Close arrives first (browser surfaced the DELETE before the message).
    act(() => m.opts?.onClose(1000));
    // No generic message yet — the grace window is open.
    expect(screen.queryByRole('alert')).toBeNull();
    // The in-flight error frame lands inside the grace window.
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4041,
        message: 'This game is no longer available.',
      }),
    );
    // The authoritative error frame wins immediately.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This game is no longer available.',
    );
    // Even after the grace window elapses, the specific message is NOT replaced
    // by the generic one.
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This game is no longer available.',
    );
  });

  it('message-then-close: the specific message is shown and the close never overwrites it', async () => {
    const m = submit();
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4040,
        message: 'Game not found. Check the code and try again.',
      }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Game not found. Check the code and try again.',
    );
    act(() => m.opts?.onClose(1000));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Game not found. Check the code and try again.',
    );
  });

  it('close-with-no-message: generic message renders only after the grace window', async () => {
    const m = submit();
    // A CLEAN close (1000/1001 — server DELETE or graceful close) with no
    // preceding error frame is a genuine disconnect, not a code-not-found deny.
    act(() => m.opts?.onClose(1000));
    // Within the grace window, nothing is rendered yet.
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    );
  });
});

// OI-33 (R4.0) — the REAL wire signal for code-not-found on the JOIN-BY-CODE
// flow. A guest submits `?code=<CODE>`; the deployed `$connect` AUTHORIZER does
// the GSI lookup and DENIES an unknown code (reason `code-not-found`), so the WS
// handshake is REFUSED (HTTP 403) and the `join` route NEVER runs — the server
// therefore never emits the `{type:'error',code:4040}` MESSAGE frame. At the
// browser an authorizer-refused handshake surfaces as an ABNORMAL close (1006)
// with NO preceding error frame. In the join-by-code flow that abnormal,
// frame-less close IS the code-not-found signal, so the SPA must render the
// actionable "Game not found." message — not the generic one (F3/T5/AC4.5).
describe('JoinScreen — OI-33: $connect-refused code (abnormal close = code-not-found)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function submitCode() {
    const m = mockFactory();
    render(<JoinScreen connect={m.factory} />);
    fireEvent.change(screen.getByLabelText(/game code/i), {
      target: { value: 'XXXXXX' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    return m;
  }

  it('abnormal close (1006) with no error frame → "Game not found." (authorizer refused the bad code)', () => {
    const m = submitCode();
    act(() => m.opts?.onClose(1006));
    // No grace window: an abnormal close on the join-by-code flow is immediately
    // the code-not-found case (the authorizer never let the handshake complete,
    // so no in-flight error frame can ever arrive).
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Game not found. Check the code and try again.',
    );
    // The code is retained so the player can correct and retry (F3).
    expect(screen.getByLabelText(/game code/i)).toHaveValue('XXXXXX');
  });

  it('an authoritative error frame still wins over an abnormal close (4041 specific message)', () => {
    const m = submitCode();
    act(() =>
      m.opts?.onMessage({
        type: 'error',
        code: 4041,
        message: 'This game is no longer available.',
      }),
    );
    act(() => m.opts?.onClose(1006));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This game is no longer available.',
    );
  });
});
