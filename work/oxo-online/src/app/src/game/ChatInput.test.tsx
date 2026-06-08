import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from './ChatInput';

/**
 * @covers chat-input
 *
 * ChatInput — the labelled text field + Send button. On submit (Enter OR Send
 * click) it calls `onSend(text)` and clears itself; focus STAYS in the input
 * (WCAG-S014-5/-6 / AC2.5, AC2.6). Empty/whitespace-only submit is a no-op
 * (AC2.7). Labelled "Chat message"; Send named "Send"; maxlength=200 mirrors
 * the server bound (AC2.3, AC2.4). NOT autofocused on mount (WCAG-S014-6).
 */
describe('ChatInput — labelled controls (WCAG-S014-1, AC2.3/AC2.4)', () => {
  it('resolves the text field by role=textbox name "Chat message" with testid + maxlength', () => {
    render(<ChatInput onSend={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: 'Chat message' });
    expect(field).toBe(screen.getByTestId('chat-input'));
    expect(field).toHaveAttribute('maxlength', '200');
  });

  it('resolves the Send button by role=button name "Send" with testid', () => {
    render(<ChatInput onSend={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn).toBe(screen.getByTestId('chat-send-btn'));
  });

  it('is NOT autofocused on mount (WCAG-S014-6)', () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByTestId('chat-input')).not.toHaveFocus();
  });
});

describe('ChatInput — Enter-to-send (WCAG-S014-5/-6, AC2.5)', () => {
  it('calls onSend with the typed text, clears the input, and keeps focus', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const field = screen.getByTestId('chat-input');
    await userEvent.click(field);
    await userEvent.type(field, 'good luck{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('good luck');
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });
});

describe('ChatInput — Send-click (WCAG-S014-5/-6, AC2.6)', () => {
  it('calls onSend with the typed text, clears the input, and returns focus to the input', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const field = screen.getByTestId('chat-input');
    await userEvent.type(field, 'gg');
    await userEvent.click(screen.getByTestId('chat-send-btn'));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith('gg');
    expect(field).toHaveValue('');
    expect(field).toHaveFocus();
  });
});

describe('ChatInput — empty/whitespace submit is a no-op (AC2.7)', () => {
  it('does NOT call onSend and does NOT clear on an empty Enter', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const field = screen.getByTestId('chat-input');
    await userEvent.click(field);
    await userEvent.keyboard('{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend on a whitespace-only Send click; input retains its value', async () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} />);
    const field = screen.getByTestId('chat-input');
    await userEvent.type(field, '   ');
    await userEvent.click(screen.getByTestId('chat-send-btn'));
    expect(onSend).not.toHaveBeenCalled();
    expect(field).toHaveValue('   ');
  });
});
