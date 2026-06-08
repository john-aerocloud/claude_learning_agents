import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createRealSocketFactory,
  type ServerMessage,
  type ClientFrame,
} from './socket';

// s007 UC3 contract (compile-time): the ServerMessage union admits the
// opponent-disconnected frame the survivor receives. This fails `tsc`/build
// until the union gains the member — the type-level red for UC3-S1.
const _opponentDisconnected: ServerMessage = { type: 'opponent-disconnected' };
void _opponentDisconnected;

// s014 UC2 contract (compile-time): the ClientFrame union admits the chat send
// frame and the ServerMessage union admits the chat-message relay/echo frame.
// These fail `tsc`/build until the unions gain the members — the type-level red
// for UC2-SP1 (the chat wire shapes the SPA sends and receives).
const _chatSend: ClientFrame = { action: 'chat', gameId: 'g1', text: 'hi' };
void _chatSend;
const _chatMessage: ServerMessage = {
  action: 'chat-message',
  sender: 'host',
  text: 'hi',
};
void _chatMessage;

/**
 * A controllable fake of the browser `WebSocket`. Tests drive `open`, inbound
 * `message`, and `close` synchronously — no network is touched (C2 contract).
 */
class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  closed = false;
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.closed = true;
  }

  // Test drivers ----------------------------------------------------------
  fireOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  fireMessage(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  fireClose(code: number) {
    this.onclose?.({ code });
  }
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  (window as unknown as { OXO_CONFIG?: { wsUrl?: string } }).OXO_CONFIG = {
    wsUrl: 'wss://ws.example.com/prod',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { OXO_CONFIG?: unknown }).OXO_CONFIG;
});

describe('createRealSocketFactory — real WebSocket transport (C2)', () => {
  it('opens a WebSocket at window.OXO_CONFIG.wsUrl', () => {
    const factory = createRealSocketFactory();
    factory({ onMessage: () => {}, onClose: () => {} });
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://ws.example.com/prod');
  });

  it('parses an inbound game-ready frame and forwards it to onMessage', () => {
    const onMessage = vi.fn();
    const factory = createRealSocketFactory();
    factory({ onMessage, onClose: () => {} });
    FakeWebSocket.instances[0].fireOpen();
    FakeWebSocket.instances[0].fireMessage({ type: 'game-ready', role: 'guest', gameId: 'g-1' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'game-ready', role: 'guest', gameId: 'g-1' });
  });

  // UC3 / s007 / AC3.1: the server posts an opponent-disconnected frame to the
  // survivor when its opponent's $disconnect abandons the active game. The
  // transport must parse it and forward it like any other ServerMessage.
  it('parses an inbound opponent-disconnected frame and forwards it to onMessage (s007 UC3)', () => {
    const onMessage = vi.fn();
    const factory = createRealSocketFactory();
    factory({ onMessage, onClose: () => {} });
    FakeWebSocket.instances[0].fireOpen();
    FakeWebSocket.instances[0].fireMessage({ type: 'opponent-disconnected' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'opponent-disconnected' });
  });

  it('parses an inbound error frame and forwards it to onMessage (DEFECT-005-001 Bug B)', () => {
    const onMessage = vi.fn();
    const factory = createRealSocketFactory();
    factory({ onMessage, onClose: () => {} });
    FakeWebSocket.instances[0].fireOpen();
    FakeWebSocket.instances[0].fireMessage({
      type: 'error',
      code: 4040,
      message: 'Game not found. Check the code and try again.',
    });
    expect(onMessage).toHaveBeenCalledWith({
      type: 'error',
      code: 4040,
      message: 'Game not found. Check the code and try again.',
    });
  });

  it('forwards the close code to onClose', () => {
    const onClose = vi.fn();
    const factory = createRealSocketFactory();
    factory({ onMessage: () => {}, onClose });
    FakeWebSocket.instances[0].fireClose(4041);
    expect(onClose).toHaveBeenCalledWith(4041);
  });

  it('sends frames once the socket is open, buffering until then', () => {
    const factory = createRealSocketFactory();
    const socket = factory({ onMessage: () => {}, onClose: () => {} });
    const ws = FakeWebSocket.instances[0];
    // Sent before open is buffered, then flushed on open.
    socket.send({ action: 'join', code: 'ABC123' });
    expect(ws.sent).toHaveLength(0);
    ws.fireOpen();
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ action: 'join', code: 'ABC123' });
    // After open, sends go straight through.
    socket.send({ action: 'register', gameId: 'g-1' });
    expect(JSON.parse(ws.sent[1])).toEqual({ action: 'register', gameId: 'g-1' });
  });

  it('close() tears the transport down and is idempotent', () => {
    const factory = createRealSocketFactory();
    const socket = factory({ onMessage: () => {}, onClose: () => {} });
    const ws = FakeWebSocket.instances[0];
    socket.close();
    socket.close();
    expect(ws.closeCalls).toBe(1);
  });

  // UC3 / AC3.1 (T8): the host threads the create-game wsToken to the factory;
  // the factory appends it as a `?wsToken=` query param on the configured wss URL
  // so the deployed $connect authorizer can verify it.
  it('appends ?wsToken=<token> to the URL when a wsToken credential is supplied (UC3/AC3.1)', () => {
    const factory = createRealSocketFactory();
    factory({
      onMessage: () => {},
      onClose: () => {},
      credential: { wsToken: 'tok-abc.sig-xyz' },
    });
    expect(FakeWebSocket.instances[0].url).toBe(
      'wss://ws.example.com/prod?wsToken=tok-abc.sig-xyz',
    );
  });

  // UC3 graceful degradation (DEFECT-H2-001): a degraded mint omits wsToken, so
  // the host connects WITHOUT the param rather than blocking — the create must
  // never be lost just because the secret was unavailable.
  it('connects without ?wsToken when no credential is supplied (degraded mint)', () => {
    const factory = createRealSocketFactory();
    factory({ onMessage: () => {}, onClose: () => {} });
    expect(FakeWebSocket.instances[0].url).toBe('wss://ws.example.com/prod');
  });

  // UC4 / AC4.1 (T8): the guest threads the entered code to the factory; the
  // factory appends it as a URL-encoded `?code=` query param so the authorizer
  // can run the GSI lookup.
  it('appends ?code=<CODE> to the URL when a code credential is supplied (UC4/AC4.1)', () => {
    const factory = createRealSocketFactory();
    factory({
      onMessage: () => {},
      onClose: () => {},
      credential: { code: 'ABC234' },
    });
    expect(FakeWebSocket.instances[0].url).toBe(
      'wss://ws.example.com/prod?code=ABC234',
    );
  });

  it('URL-encodes a code credential with reserved characters (UC4/AC4.1)', () => {
    const factory = createRealSocketFactory();
    factory({
      onMessage: () => {},
      onClose: () => {},
      credential: { code: 'A B&C' },
    });
    expect(FakeWebSocket.instances[0].url).toBe(
      'wss://ws.example.com/prod?code=A%20B%26C',
    );
  });

  it('degrades gracefully when no wsUrl is configured (s004 style): closes 4500, opens nothing', () => {
    delete (window as unknown as { OXO_CONFIG?: unknown }).OXO_CONFIG;
    const onClose = vi.fn();
    const factory = createRealSocketFactory();
    factory({ onMessage: () => {}, onClose });
    // No real socket is opened; the UI is told the connection failed.
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(onClose).toHaveBeenCalledWith(4500);
  });
});
