// Shared WebSocket handler result contract (s005).
//
// A WS route handler returns a WsResult describing the outcome. The runtime
// adapter (handler.ts dispatch) translates this into the API Gateway proxy
// response and, where a close is requested, into the client-visible close.
//
// Close-code contract (S3 — clean error contract; ties to F3/F4/F9):
//   4040 — unknown code (UC2)
//   4041 — game no longer available / no-hijack rejection (UC4)
//   4500 — internal error (UC2/UC3)
// No close reason or frame delivered to the client carries a stack trace,
// exception class, table ARN, AWS request id, or any other internal detail —
// only the human-readable text the F-cases specify.

export type WsCloseCode = 4040 | 4041 | 4500;

export interface WsClose {
  /** One of exactly the three defined close codes. */
  code: WsCloseCode;
  /** Human-readable, customer-facing reason. Never internal detail. */
  reason: string;
}

export interface WsResult {
  /** API Gateway proxy status code for the route response. */
  statusCode: number;
  /**
   * When present, the handler is directing the socket to be closed with this
   * code/reason. The transport adapter is responsible for delivering it; the
   * handler itself performs no further writes once a close is set.
   */
  close?: WsClose;
}

/** Customer-facing close messages — the exact text the SPA renders (S3/F-cases). */
export const CLOSE_MESSAGES: Record<WsCloseCode, string> = {
  4040: 'Game not found. Check the code and try again.',
  4041: 'This game is no longer available.',
  4500: 'Something went wrong. Please try again.',
};

/** Build a close result with the canonical message for the code. */
export function close(code: WsCloseCode): WsResult {
  return { statusCode: code === 4500 ? 500 : 400, close: { code, reason: CLOSE_MESSAGES[code] } };
}
