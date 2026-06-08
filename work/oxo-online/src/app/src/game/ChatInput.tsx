import { useId, useRef, useState } from 'react';

/**
 * chat-input (class-deps) — the labelled chat text field + Send button. On
 * submit (Enter via the form OR Send click) it calls `onSend(text)` and clears
 * itself, then KEEPS focus in the (now-cleared) input (WCAG-S014-6 / AC2.5,
 * AC2.6) — focus is never moved to the board, the button, or document body.
 *
 * - Labelled "Chat message" via a programmatically associated `<label>`
 *   (NOT placeholder-as-label) and the Send button is named "Send" (WCAG-S014-1
 *   / AC2.3, AC2.4).
 * - `maxLength=200` mirrors the server bound (T-CHAT-4); the server is the
 *   authority — this is a client-side affordance, not the trust boundary.
 * - Empty/whitespace-only submit is a NO-OP: nothing dispatched, input retained
 *   (AC2.7). The trim is the no-op guard only; the server re-trims and
 *   normalises authoritatively.
 * - NOT autofocused on mount and never grabs focus on its own (WCAG-S014-6).
 *
 * Presentational + local controlled value only. The WS dispatch, gameId
 * threading, and self-role resolution are GameRoot's state/port logic — the
 * hexagonal boundary keeps this component transport-free.
 */
interface ChatInputProps {
  /** Called with the trimmed-non-empty text on a valid submit. */
  onSend: (text: string) => void;
}

const MAX_LEN = 200;

export function ChatInput({ onSend }: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (value.trim() === '') return; // empty/whitespace-only is a no-op (AC2.7).
    onSend(value);
    setValue('');
    // Focus stays in the (now-cleared) input — never the board/button/body.
    inputRef.current?.focus();
  };

  return (
    <form className="chat-input-form" onSubmit={submit}>
      <label htmlFor={inputId} className="chat-input-label">
        Chat message
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="chat-input"
        data-testid="chat-input"
        type="text"
        maxLength={MAX_LEN}
        autoComplete="off"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="chat-send-btn" data-testid="chat-send-btn">
        Send
      </button>
    </form>
  );
}
