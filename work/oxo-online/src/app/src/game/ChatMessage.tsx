import type { ChatMessage as ChatMessageFrame } from './socket';

/**
 * chat-message (class-deps) — one chat row: a TEXT sender label + the message
 * text. Pure presentation from a relay/echo frame plus the viewer's own role.
 *
 * WCAG-S014-7 (AC2.11): self/other is carried by the LABEL TEXT ("You" /
 * "Opponent"), never by colour alone — distinguishable with colour disabled.
 *
 * T-CHAT-3 / WCAG-S014-8 (AC2.10): the message text is rendered via React
 * `{message.text}` interpolation ONLY. React's default escaping renders any
 * markup (e.g. `<img src=x onerror=alert(1)>`) as literal text — no node is
 * created, no script runs. Any raw-HTML sink (the dangerous innerHTML-class
 * React prop) is PROHIBITED on the chat components — the src/game/ code-policy
 * pin in policy.test.tsx greps every non-test source for that literal and fails
 * the build if it appears. The server normalisation at the relay boundary is
 * defence-in-depth, not the primary control.
 */
interface ChatMessageProps {
  /** The relay/echo frame `{sender, text}` (the `action` field is not needed here). */
  message: Pick<ChatMessageFrame, 'sender' | 'text'>;
  /** The viewer's own role, used to resolve the "You"/"Opponent" label. */
  selfRole: 'host' | 'guest';
}

export function ChatMessage({ message, selfRole }: ChatMessageProps) {
  const label = message.sender === selfRole ? 'You' : 'Opponent';
  return (
    <li className="chat-message" data-testid="chat-message">
      <span className="chat-message-sender" data-testid="chat-message-sender">
        {label}
      </span>
      <span className="chat-message-text" data-testid="chat-message-text">
        {message.text}
      </span>
    </li>
  );
}
