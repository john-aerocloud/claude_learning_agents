import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRealSocketFactory } from './socket';

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
    FakeWebSocket.instances[0].fireMessage({ type: 'game-ready', role: 'guest' });
    expect(onMessage).toHaveBeenCalledWith({ type: 'game-ready', role: 'guest' });
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
