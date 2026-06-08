import type { ChatMessage as ChatMessageFrame } from './socket';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';

/**
 * chat-panel (class-deps) — the chat region container, rendered BELOW the board
 * as a sibling of OnlineBoard inside the `playing-online` active branch. It owns
 * the region landmark + heading and composes ChatMessageList + ChatInput.
 *
 * WCAG-S014-2 (AC2.1): `role="region"` with accessible name "Game chat", a
 * DISTINCT landmark from the board region (the board keeps its own
 * `aria-label="online game board"`, unchanged). A screen-reader user can jump to
 * chat or skip past it to the board.
 *
 * LAYOUT-S014-1: the panel sits below the board (never inside the board
 * container) so the 3×3 grid geometry is undisturbed; the vertical stacking and
 * below-board placement are pinned by the layout geometry spec.
 *
 * Presentational only — `messages`, `selfRole`, and `onSend` are GameRoot's
 * state/port logic (hexagonal boundary; this component touches no transport).
 */
interface ChatPanelProps {
  /** The in-memory message list (most-recent last). */
  messages: ChatMessageFrame[];
  /** The viewer's own role, threaded to the list to resolve "You"/"Opponent". */
  selfRole: 'host' | 'guest';
  /** Called with the trimmed-non-empty text when the player sends a message. */
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, selfRole, onSend }: ChatPanelProps) {
  return (
    <section
      className="chat-panel"
      data-testid="chat-panel"
      role="region"
      aria-label="Game chat"
    >
      <h2 className="chat-heading">Chat</h2>
      <ChatMessageList messages={messages} selfRole={selfRole} />
      <ChatInput onSend={onSend} />
    </section>
  );
}
