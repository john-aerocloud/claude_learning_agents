import type { ChatMessage as ChatMessageFrame } from './socket';
import { ChatMessage } from './ChatMessage';

/**
 * chat-message-list (class-deps) — the in-memory chat log as a vertical stack of
 * ChatMessage rows (LAYOUT-S014-1: `.chat-messages` is a column flex container;
 * the geometry is pinned by the local/skeleton layout spec, not re-asserted in
 * jsdom which has no layout).
 *
 * LIVE REGION (WCAG-S014-3 / AC2.8, AC2.9): this list IS the live region —
 * `role="log"`, `aria-live="polite"`, `aria-relevant="additions"`. New messages
 * are appended as children INSIDE this element (never by replacing it) so
 * assistive tech announces each new message (own echo + opponent relay) WITHOUT
 * moving focus. Accessible name "Messages".
 *
 * Empty state (AC2.16): renders explicit copy, never a blank void.
 */
interface ChatMessageListProps {
  /** The in-memory message list, most-recent last. */
  messages: ChatMessageFrame[];
  /** The viewer's own role, threaded down so each row resolves "You"/"Opponent". */
  selfRole: 'host' | 'guest';
}

const EMPTY_TEXT = 'No messages yet — say hi.';

export function ChatMessageList({ messages, selfRole }: ChatMessageListProps) {
  return (
    <ul
      className="chat-messages"
      data-testid="chat-messages"
      role="log"
      aria-label="Messages"
      aria-live="polite"
      aria-relevant="additions"
    >
      {messages.length === 0 ? (
        <li className="chat-empty" data-testid="chat-empty">
          {EMPTY_TEXT}
        </li>
      ) : (
        messages.map((message, index) => (
          <ChatMessage
            // In-memory append-only list; index is a stable key for this render
            // model (messages are never reordered or removed, only appended).
            key={index}
            message={message}
            selfRole={selfRole}
          />
        ))
      )}
    </ul>
  );
}
