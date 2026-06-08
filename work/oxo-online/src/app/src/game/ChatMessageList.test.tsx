import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage as ChatMessageFrame } from './socket';

/**
 * @covers chat-message-list
 *
 * ChatMessageList — the in-memory message log, rendered as a vertical stack of
 * ChatMessage rows. It IS the live region: `role="log"` + `aria-live="polite"`
 * + `aria-relevant="additions"` (WCAG-S014-3 / AC2.8) so a screen reader
 * announces each new message without focus moving. New messages append INSIDE
 * the live-region element (AC2.9). Empty state renders explicit copy, not a
 * blank void (AC2.16).
 */
function msg(sender: 'host' | 'guest', text: string): ChatMessageFrame {
  return { action: 'chat-message', sender, text };
}

describe('ChatMessageList — live region (WCAG-S014-3, AC2.8)', () => {
  it('resolves by role=log with accessible name "Messages"', () => {
    render(<ChatMessageList messages={[]} selfRole="host" />);
    expect(screen.getByRole('log', { name: 'Messages' })).toBeInTheDocument();
  });

  it('exposes role=log, aria-live=polite and aria-relevant=additions', () => {
    render(<ChatMessageList messages={[]} selfRole="host" />);
    const log = screen.getByTestId('chat-messages');
    expect(log).toHaveAttribute('role', 'log');
    expect(log).toHaveAttribute('aria-live', 'polite');
    expect(log).toHaveAttribute('aria-relevant', 'additions');
  });
});

describe('ChatMessageList — messages append inside the live region (AC2.9)', () => {
  it('renders a chat-message child INSIDE the live region after one message', () => {
    render(<ChatMessageList messages={[msg('host', 'hi')]} selfRole="host" />);
    const log = screen.getByTestId('chat-messages');
    const rows = within(log).getAllByTestId('chat-message');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByTestId('chat-message-text')).toHaveTextContent('hi');
  });

  it('renders a second message as another child of the SAME live region', () => {
    render(
      <ChatMessageList
        messages={[msg('host', 'hi'), msg('guest', 'yo')]}
        selfRole="host"
      />,
    );
    const log = screen.getByTestId('chat-messages');
    const rows = within(log).getAllByTestId('chat-message');
    expect(rows).toHaveLength(2);
    // Order preserved: most-recent last.
    expect(within(rows[0]).getByTestId('chat-message-text')).toHaveTextContent('hi');
    expect(within(rows[1]).getByTestId('chat-message-text')).toHaveTextContent('yo');
    // Self/other labels resolve against the viewer's own role.
    expect(within(rows[0]).getByTestId('chat-message-sender')).toHaveTextContent('You');
    expect(within(rows[1]).getByTestId('chat-message-sender')).toHaveTextContent('Opponent');
  });
});

describe('ChatMessageList — empty state (AC2.16)', () => {
  it('shows the empty-state prompt and renders no message rows', () => {
    render(<ChatMessageList messages={[]} selfRole="host" />);
    expect(screen.getByText('No messages yet — say hi.')).toBeInTheDocument();
    expect(screen.queryAllByTestId('chat-message')).toHaveLength(0);
  });
});
