import { useEffect, useRef, useState } from 'react';
import { initialState, applyMove, reset } from './engine';
import { bestMove } from './ai';
import { Board } from './Board';
import { Status } from './Status';
import { JoinScreen } from './JoinScreen';
import { OnlineBoard } from './OnlineBoard';
import { ChatPanel } from './ChatPanel';
import { NameField } from './NameField';
import { normaliseName, DEFAULT_NAME } from './name';
import { Leaderboard } from './Leaderboard';
import { fetchLeaderboard, type LeaderboardEntry } from './leaderboard-client';
import {
  createRealSocketFactory,
  type GameSocket,
  type GameSocketFactory,
  type ServerMessage,
  type ChatMessage,
} from './socket';

const EMPTY_BOARD_STRING = '---------';

/** Server-authoritative online board state, driven STRICTLY by server frames. */
interface OnlineGameState {
  /** Latest `board` string from a `board-update` (`X`/`O`/`-`). */
  board: string;
  /** Whose move the server will accept next. */
  currentTurn: 'X' | 'O';
  /** Set once a `game-over` frame arrives. */
  result?: 'X-wins' | 'O-wins' | 'draw';
}

const INITIAL_ONLINE_STATE: OnlineGameState = {
  board: EMPTY_BOARD_STRING,
  currentTurn: 'X',
};

type Mode = 'two-player' | 'vs-computer';
type OnlinePhase =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'joining'
  | 'playing-online'
  | 'disconnected'
  | 'error';

const ONLINE_ERROR = 'Could not start online game — please try again';
// s009 UC1 — sessionStorage key the name field round-trips through (SM-8/T-LB-12).
const NAME_STORAGE_KEY = 'oxo.playerName';
// s008 UC1 — how long the copy control shows "Copied!" before reverting (~2s).
const COPIED_REVERT_MS = 2000;
const COPY_LINK_LABEL = 'Copy link';
const COPY_CODE_LABEL = 'Copy code';
const COPIED_LABEL = 'Copied!';
// s007 UC3 / AC3.1 — exact pinned survivor message text. The tester's
// two-browser smoke keys off this exact string; do not reword without updating
// AC3.1, the disconnect skeleton, and the local survivor spec.
const OPPONENT_DISCONNECTED = 'Your opponent disconnected.';
const SPINNER_DELAY_MS = 500;

/**
 * Default socket factory. C2 plugs in the real `WebSocket`-backed factory that
 * reads `window.OXO_CONFIG.wsUrl` and degrades gracefully when no URL is
 * configured. Tests still inject an in-memory factory so no network is touched.
 * The components never see the transport.
 */
const realFactory: GameSocketFactory = createRealSocketFactory();

interface GameRootProps {
  /** Injectable socket seam (defaults to the real WS factory; tests inject a mock). */
  socketFactory?: GameSocketFactory;
  /**
   * s008 UC2 — deep-link code. When the SPA mounts on the `/join/:code` route the
   * App router passes the URL `:code` segment here so the game opens directly in
   * the `joining` phase with the JoinScreen pre-filled (one-click join, T2/SM-2).
   * Undefined for the normal `/` route, which opens in the local-game `idle`
   * phase with the mode selector (no regression, AC3.1).
   */
  initialJoinCode?: string;
}

/** Root of the game: owns state + mode, wires the mode selector, Status, Board. */
export function GameRoot({ socketFactory = realFactory, initialJoinCode }: GameRootProps = {}) {
  const [state, setState] = useState(initialState);
  const [mode, setMode] = useState<Mode>('two-player');
  // s009 UC1. The "Your name" arcade tag, pre-filled from sessionStorage (else
  // "AAA"). The field NEVER gates play — the default makes it ignorable
  // (click-path BINDING). It is normalised at send time (the SAME pinned
  // transform the server re-applies authoritatively) and threaded into
  // POST /api/games (host) + the WS join frame (guest).
  const [playerName, setPlayerName] = useState<string>(
    () =>
      (typeof sessionStorage !== 'undefined' &&
        sessionStorage.getItem(NAME_STORAGE_KEY)) ||
      DEFAULT_NAME,
  );

  // Persist the normalised name and return it (called on a successful create/
  // join so the next game in this tab pre-fills it — SM-8/T-LB-12).
  const persistName = (): string => {
    const normalised = normaliseName(playerName);
    try {
      sessionStorage.setItem(NAME_STORAGE_KEY, normalised);
    } catch {
      // sessionStorage unavailable (private mode) — name is non-essential.
    }
    return normalised;
  };

  // s009 UC3. The shared leaderboard panel renders on the idle view (below the
  // board) and fetches GET /api/leaderboard on each idle mount / return-to-idle.
  // Read-only + non-critical: a failed fetch shows a graceful error state, NOT
  // an aggressive retry loop (re-fetch on next idle).
  const [leaderboardStatus, setLeaderboardStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
  // s008 UC2: a deep-link mounts straight into the `joining` phase so the
  // pre-filled JoinScreen is shown immediately; otherwise the local game `idle`.
  const [onlinePhase, setOnlinePhase] = useState<OnlinePhase>(
    initialJoinCode ? 'joining' : 'idle',
  );
  const [showSpinner, setShowSpinner] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  // s009 UC4. The waiting screen offers TWO controls — "Copy code" (the 6-char
  // code, for a guest who TYPES it) and "Copy link" (the /join/:code URL, for a
  // guest who CLICKS it). DEFECT-S008-002: previously only the link affordance
  // existed, so the type path had no control. `copiedControl` tracks which
  // button last copied (for its 2s "Copied!" feedback).
  const [copiedControl, setCopiedControl] = useState<'code' | 'link' | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  // The host's $connect credential, minted by POST /api/games. A degraded mint
  // (DEFECT-H2-001) legitimately omits it — the host then connects without the
  // param rather than being blocked.
  const [wsToken, setWsToken] = useState<string | null>(null);
  const [onlineRole, setOnlineRole] = useState<'host' | 'guest'>('host');
  const [onlineGame, setOnlineGame] = useState<OnlineGameState>(INITIAL_ONLINE_STATE);
  // s014 UC2 — the in-memory chat log. Local React state ONLY: never persisted,
  // and cleared on every online-session boundary (game-end, opponent-disconnect,
  // leaving the online flow) so a fresh game starts with an empty chat (SP-C4 /
  // slice "in-memory: no persistence"). Both the player's own echo and the
  // opponent's relay arrive as `chat-message` frames and append here.
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout>>();
  const hostSocketRef = useRef<GameSocket | null>(null);
  // The live socket carrying this player's moves and broadcasts. For the host
  // it is the register socket; for the guest it is handed up by JoinScreen on
  // game-ready (UC4 move loop — moves must travel over the SAME connection).
  const playSocketRef = useRef<GameSocket | null>(null);
  // The gameId the server announced on game-ready — the single consistent source
  // threaded into every move frame as the non-trusted GetItem lookup key (S1).
  const playGameIdRef = useRef<string | null>(null);
  // s007 UC3 — true once a game-over result has been shown. A late
  // opponent-disconnected frame arriving AFTER the result is IGNORED (result
  // wins): the survivor already saw the win/draw; a trailing disconnect from the
  // loser closing their tab must not clobber the result screen.
  const resultShownRef = useRef(false);

  // A `game-ready` from either side drives both screens to the board, captures
  // the live socket for the move loop (UC4), and resets the online board. A
  // `board-update`/`game-over` (UC4) updates the server-authoritative board.
  // An error frame (DEFECT-005-001 Bug B — the host's register failure path)
  // degrades to the readable online-error screen rather than white-screening.
  // The JoinScreen handles its own pre-game-ready error frames inline.
  const handleGameReady = (message: ServerMessage, socket?: GameSocket) => {
    // s014 UC2 (SP-C4): a chat-message frame (own echo OR opponent relay) appends
    // to the in-memory list via the SAME render path for both. The chat frame is
    // discriminated by `action` (the WS route's wire shape), distinct from the
    // `type`-discriminated game frames below — narrow on it first.
    if ('action' in message) {
      // Only the chat-message frame carries `action` (all game frames are
      // `type`-discriminated); appending it here also excludes it from the
      // `type` narrowing below so tsc resolves the remaining union cleanly.
      setChatMessages((list) => [...list, message]);
      return;
    }
    if (message.type === 'game-ready') {
      if (socket) playSocketRef.current = socket;
      // GATE-AMEND (s006): the game-ready frame is the SPA's single consistent
      // source of gameId — both host and guest thread THIS into every move send.
      // The guest (joined by code) has no other source; the host overwrites its
      // create-time gameId with the same value, keeping one source of truth.
      playGameIdRef.current = message.gameId;
      resultShownRef.current = false;
      setOnlineRole(message.role);
      setOnlineGame(INITIAL_ONLINE_STATE);
      // s014 UC2: a fresh game starts with an empty chat (no leak across games).
      setChatMessages([]);
      setOnlinePhase('playing-online');
    } else if (message.type === 'board-update') {
      setOnlineGame((g) => ({
        ...g,
        board: message.board,
        currentTurn: message.currentTurn,
      }));
    } else if (message.type === 'game-over') {
      resultShownRef.current = true;
      setOnlineGame((g) => ({ ...g, result: message.result }));
    } else if (message.type === 'opponent-disconnected') {
      // s007 UC3 — the opponent's $disconnect abandoned the active game. Show
      // the survivor message and return to the mode selector WITHOUT a reload:
      // close the WS and clear all online state so the board goes inert and a
      // fresh Online game can start cleanly (UC3-S3). Result wins: a frame
      // arriving after game-over is ignored (the survivor already saw the
      // result; do not clobber the result screen).
      if (resultShownRef.current) return;
      endOnlineSession('disconnected');
    } else if (message.type === 'error') {
      setOnlinePhase('error');
    }
  };

  // Tear down the live online session and move to `phase`. Closes the WS (no
  // stale socket — AC3.3) and clears EVERY online ref/state so the subsequent
  // playOnline/joinGame opens a clean socket with no residual gameId, board, or
  // connection (UC3-S3 / AC3.4). The gameId-keyed effect cleanup also closes the
  // host socket when gameId clears; closing playSocketRef here covers the guest
  // (whose socket is owned by JoinScreen) and makes the close synchronous.
  const endOnlineSession = (phase: OnlinePhase) => {
    playSocketRef.current?.close();
    playSocketRef.current = null;
    playGameIdRef.current = null;
    resultShownRef.current = false;
    setGameCode(null);
    setGameId(null);
    setWsToken(null);
    setOnlineGame(INITIAL_ONLINE_STATE);
    // s014 UC2: chat is in-memory only — drop it when the session ends (SP-C4).
    setChatMessages([]);
    setOnlinePhase(phase);
  };

  // UC4: a square click sends exactly one {action:'move', square} over the live
  // socket. The board is NOT updated optimistically — it re-renders only when the
  // server broadcasts a `board-update` (server-authoritative contract).
  const sendMove = (square: number) => {
    const id = playGameIdRef.current;
    if (!id) return; // no gameId yet (pre game-ready) — nothing to address.
    playSocketRef.current?.send({ action: 'move', gameId: id, square });
  };

  // s014 UC2 (SP-C1): send a chat message over the live socket. Server-
  // authoritative — the message is NOT rendered optimistically; it appears only
  // when the server echoes it back as a `chat-message` frame (SP-C3/SP-C4),
  // consistent with the move loop. If the chat route is not live (no echo
  // arrives) the SPA simply shows no message and never crashes — graceful
  // degradation. ChatInput has already trimmed-non-empty the text (no-op guard);
  // the server re-trims/caps/strips authoritatively (T-CHAT-4).
  const sendChat = (text: string) => {
    const id = playGameIdRef.current;
    if (!id) return; // no gameId yet (pre game-ready) — nothing to address.
    playSocketRef.current?.send({ action: 'chat', gameId: id, text });
  };

  const onSelect = (index: number) => {
    setState((current) => applyMove(current, index));
  };

  // s009 UC4 — copy EXACTLY `text` to the clipboard and flag `control` as copied
  // for ~2s. Shared by both waiting-screen controls so each copies the correct
  // thing (code vs URL) with identical feedback. On rejection (denied / insecure
  // context) the code stays visible for manual copy (no retry — local browser API).
  const copyToClipboard = async (control: 'code' | 'link', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedControl(control);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedControl(null), COPIED_REVERT_MS);
    } catch {
      setCopiedControl(null);
    }
  };

  const copyCode = () => {
    if (gameCode) void copyToClipboard('code', gameCode);
  };
  const copyLink = () => {
    if (gameCode) void copyToClipboard('link', `${window.location.origin}/join/${gameCode}`);
  };

  // Clear the "Copied!" revert timer if the component unmounts mid-window.
  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const playOnline = async () => {
    setOnlinePhase('creating');
    // Spinner only appears for waits longer than 500ms (F3).
    spinnerTimer.current = setTimeout(() => setShowSpinner(true), SPINNER_DELAY_MS);
    // s009 UC1: normalise + persist the name and send it in the POST body so
    // `oxo-game-fn` writes hostName (an empty field posts the "AAA" default).
    const createName = persistName();
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: createName }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as {
        gameId: string;
        code: string;
        // Absent on a degraded mint (DEFECT-H2-001) — the create still succeeds.
        wsToken?: string;
      };
      setGameId(body.gameId);
      setGameCode(body.code);
      setWsToken(body.wsToken ?? null);
      setOnlinePhase('waiting');
    } catch {
      setOnlinePhase('error');
    } finally {
      clearTimeout(spinnerTimer.current);
      setShowSpinner(false);
    }
  };

  // When the host has created a game (gameId set), open the socket ONCE and
  // register so the server can reach them with `game-ready` (UC1/C2). The socket
  // MUST persist past the `waiting -> playing-online` transition because UC4's
  // move loop sends/receives moves over this SAME connection — so the effect is
  // keyed on `gameId` (not `onlinePhase`): it opens when the game is created and
  // tears down only when the player leaves the online flow (gameId cleared by
  // selectMode/joinGame). Keying it on onlinePhase would close the live socket
  // the instant game-ready flipped the phase, breaking every host move.
  useEffect(() => {
    if (!gameId) return;
    const socket = socketFactory({
      // The host's $connect credential is the minted wsToken (UC3/AC3.1, T8).
      // On a degraded mint it is null -> connect with no param (graceful
      // degradation; the host is never blocked, DEFECT-H2-001).
      ...(wsToken ? { credential: { wsToken } } : {}),
      // The host's register socket is also the move-relay socket (UC4) — route
      // every server frame through the same handler and bind it as the play
      // socket so the host's moves travel over this connection.
      onMessage: (message) => handleGameReady(message, socket),
      onClose: () => {},
    });
    hostSocketRef.current = socket;
    socket.send({ action: 'register', gameId });
    return () => {
      socket.close();
      hostSocketRef.current = null;
    };
    // socketFactory is stable for a render tree; wsToken is set in the same
    // transition as gameId, so it is current here. Open-once-per-game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // s009 UC3: fetch the leaderboard whenever the idle view is shown (mount or
  // return-to-idle). Keyed on `onlinePhase` so returning from a game refetches.
  useEffect(() => {
    if (onlinePhase !== 'idle') return;
    let cancelled = false;
    setLeaderboardStatus('loading');
    fetchLeaderboard().then((result) => {
      if (cancelled) return;
      if (result.status === 'ready') {
        setLeaderboardEntries(result.entries);
        setLeaderboardStatus('ready');
      } else {
        setLeaderboardStatus('error');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [onlinePhase]);

  // In vs-Computer mode the AI plays O. Run it in an effect (not the click
  // handler) so the human's X paints first, then O follows synchronously.
  useEffect(() => {
    if (
      mode === 'vs-computer' &&
      state.status === 'playing' &&
      state.currentPlayer === 'O'
    ) {
      setState((current) => applyMove(current, bestMove(current)));
    }
  }, [mode, state]);

  const selectMode = (next: Mode) => {
    setMode(next);
    setState(reset());
    // Leaving the online flow returns to a clean local game (F4/F5 fallback).
    setOnlinePhase('idle');
    setGameCode(null);
    setGameId(null);
    setWsToken(null);
    setOnlineGame(INITIAL_ONLINE_STATE);
    setChatMessages([]);
    playSocketRef.current = null;
    playGameIdRef.current = null;
    resultShownRef.current = false;
  };

  const joinGame = () => {
    setOnlinePhase('joining');
    setGameCode(null);
    setGameId(null);
    setWsToken(null);
    setOnlineGame(INITIAL_ONLINE_STATE);
    setChatMessages([]);
    playSocketRef.current = null;
    playGameIdRef.current = null;
    resultShownRef.current = false;
  };

  const locked = state.status !== 'playing';

  return (
    <main className="game" aria-label="oxo game">
      {onlinePhase === 'idle' && (
        <NameField
          value={playerName}
          onChange={setPlayerName}
          disabled={onlinePhase !== 'idle'}
        />
      )}
      <div className="mode-selector" role="group" aria-label="game mode">
        <button
          type="button"
          className="mode"
          aria-pressed={mode === 'two-player'}
          onClick={() => selectMode('two-player')}
        >
          Two player
        </button>
        <button
          type="button"
          className="mode"
          aria-pressed={mode === 'vs-computer'}
          onClick={() => selectMode('vs-computer')}
        >
          vs Computer
        </button>
        <button
          type="button"
          className="mode"
          aria-label="play online"
          onClick={playOnline}
        >
          Play Online
        </button>
        <button
          type="button"
          className="mode"
          aria-label="join a game"
          onClick={joinGame}
        >
          Join a game
        </button>
      </div>
      {onlinePhase === 'creating' && (
        <p className="online-status" role="status" aria-live="polite">
          Starting online game…{showSpinner && <span data-testid="spinner" aria-hidden="true" className="spinner" />}
        </p>
      )}
      {onlinePhase === 'waiting' && gameCode && (
        <section className="online-waiting" aria-label="waiting for opponent">
          <p>Waiting for opponent</p>
          <p className="game-code" data-testid="game-code">{gameCode}</p>
          {/* s009 UC4 — two distinct affordances for the guest's two join paths
              (type the code / click the link). DEFECT-S008-002 closure. */}
          <div className="copy-controls">
            <button
              type="button"
              className="copy-code"
              data-testid="copy-code-btn"
              onClick={copyCode}
            >
              {copiedControl === 'code' ? COPIED_LABEL : COPY_CODE_LABEL}
            </button>
            <button
              type="button"
              className="copy-link"
              data-testid="copy-link-btn"
              onClick={copyLink}
            >
              {copiedControl === 'link' ? COPIED_LABEL : COPY_LINK_LABEL}
            </button>
          </div>
          <p
            className="online-connecting"
            role="status"
            aria-live="polite"
            data-testid="host-connecting"
          >
            Connecting…
          </p>
        </section>
      )}
      {onlinePhase === 'joining' && (
        <JoinScreen
          connect={socketFactory}
          onGameReady={handleGameReady}
          initialCode={initialJoinCode}
          // s009 UC1: thread the normalised guest name into the WS join frame.
          // normaliseName is pure (no side effect at render); persistence
          // happens when the join is actually submitted (onJoin).
          playerName={normaliseName(playerName)}
          onJoin={persistName}
        />
      )}
      {onlinePhase === 'playing-online' && (
        <>
          <OnlineBoard
            role={onlineRole}
            board={onlineGame.board}
            currentTurn={onlineGame.currentTurn}
            result={onlineGame.result}
            onMove={sendMove}
          />
          {/* s014 UC2: chat is a SIBLING region BELOW the board (LAYOUT-S014-1 —
              never inside the board container, so the 3×3 grid is undisturbed).
              The input/Send are present ONLY while the game is genuinely active
              (result === undefined); once a game-over frame sets result the chat
              input is absent (slice scope / F5). The message list itself is part
              of the panel; on game-over the whole panel unmounts with the board's
              still-mounted result view, consistent with "input absent after
              game-over". */}
          {onlineGame.result === undefined && (
            <ChatPanel
              messages={chatMessages}
              selfRole={onlineRole}
              onSend={sendChat}
            />
          )}
        </>
      )}
      {onlinePhase === 'disconnected' && (
        <section
          className="opponent-disconnected"
          aria-label="opponent disconnected"
        >
          <p
            className="opponent-disconnected-message"
            role="alert"
            data-testid="opponent-disconnected"
          >
            {OPPONENT_DISCONNECTED}
          </p>
          <button
            type="button"
            className="back-to-menu"
            data-testid="back-to-menu"
            onClick={() => setOnlinePhase('idle')}
          >
            Back to menu
          </button>
        </section>
      )}
      {onlinePhase === 'error' && (
        <p className="online-error" role="alert">{ONLINE_ERROR}</p>
      )}
      {onlinePhase === 'idle' && (
        <>
          <Status
            status={state.status}
            currentPlayer={state.currentPlayer}
            winner={state.winner}
          />
          <Board board={state.board} onSelect={onSelect} locked={locked} />
          {locked && (
            <button
              type="button"
              className="play-again"
              onClick={() => setState(reset())}
            >
              Play again
            </button>
          )}
          <Leaderboard status={leaderboardStatus} entries={leaderboardEntries} />

        </>
      )}
    </main>
  );
}
