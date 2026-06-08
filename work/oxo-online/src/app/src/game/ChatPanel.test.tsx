import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage as ChatMessageFrame } from './socket';

/**
 * @covers chat-panel
 *
 * ChatPanel — the chat region container: region "Game chat" (WCAG-S014-2 /
 * AC2.1) composing ChatMessageList + ChatInput, placed below the board. It
 * forwards `messages` + `selfRole` to the list and `onSend` to the input.
 */
function msg(sender: 'host' | 'guest', text: string): ChatMessageFrame {
  return { action: 'chat-message', sender, text };
}

describe('ChatPanel — region landmark (WCAG-S014-2, AC2.1)', () => {
  it('resolves by role=region name "Game chat" with the chat-panel testid', () => {
    render(<ChatPanel messages={[]} selfRole="host" onSend={vi.fn()} />);
    const region = screen.getByRole('region', { name: 'Game chat' });
    expect(region).toBe(screen.getByTestId('chat-panel'));
  });

  it('composes the message list and the input inside the region', () => {
    render(
      <ChatPanel messages={[msg('guest', 'hi')]} selfRole="host" onSend={vi.fn()} />,
    );
    const region = screen.getByTestId('chat-panel');
    expect(within(region).getByRole('log', { name: 'Messages' })).toBeInTheDocument();
    expect(within(region).getByRole('textbox', { name: 'Chat message' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Send' })).toBeInTheDocument();
    // Opponent message renders with the "Opponent" label for a host viewer.
    expect(within(region).getByTestId('chat-message-sender')).toHaveTextContent('Opponent');
  });
});

describe('ChatPanel — send wiring', () => {
  it('forwards a submitted message to onSend', async () => {
    const onSend = vi.fn();
    render(<ChatPanel messages={[]} selfRole="host" onSend={onSend} />);
    await userEvent.type(screen.getByTestId('chat-input'), 'gl{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('gl');
  });
});
