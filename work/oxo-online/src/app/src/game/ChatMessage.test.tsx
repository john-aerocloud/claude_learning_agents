import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChatMessage } from './ChatMessage';

/**
 * @covers chat-message
 *
 * ChatMessage — one row: a TEXT sender label + the message text.
 * - Sender distinction is the LABEL text ("You"/"Opponent"), not colour-only
 *   (WCAG-S014-7 / AC2.11).
 * - Text rendered via React `{text}` interpolation ONLY — an injection string
 *   renders as literal textContent, no `<img>`/script node in the DOM
 *   (T-CHAT-3 / WCAG-S014-8 / AC2.10). The code-policy pin in policy.test.tsx
 *   enforces the no-raw-HTML-sink rule across src/game/.
 */
describe('ChatMessage — sender label (WCAG-S014-7, AC2.11)', () => {
  it('labels the message "You" when the sender role matches the viewer', () => {
    render(<ChatMessage message={{ sender: 'host', text: 'hi' }} selfRole="host" />);
    expect(screen.getByTestId('chat-message-sender')).toHaveTextContent('You');
  });

  it('labels the message "Opponent" when the sender role differs from the viewer', () => {
    render(<ChatMessage message={{ sender: 'host', text: 'hi' }} selfRole="guest" />);
    expect(screen.getByTestId('chat-message-sender')).toHaveTextContent('Opponent');
  });

  it('renders the message text in the chat-message-text element', () => {
    render(<ChatMessage message={{ sender: 'guest', text: 'good luck' }} selfRole="host" />);
    expect(screen.getByTestId('chat-message-text')).toHaveTextContent('good luck');
  });
});

describe('ChatMessage — XSS render-as-text (T-CHAT-3 / WCAG-S014-8 / AC2.10)', () => {
  const INJECTION = '<img src=x onerror=alert(1)>';

  it('renders an injection string as literal textContent with no <img> node', () => {
    const { container } = render(
      <ChatMessage message={{ sender: 'guest', text: INJECTION }} selfRole="host" />,
    );
    const textEl = screen.getByTestId('chat-message-text');
    // The raw string is shown verbatim — React escaping is the primary control.
    expect(textEl.textContent).toBe(INJECTION);
    // No element node was created from the injected markup anywhere in the row.
    expect(container.querySelector('img')).toBeNull();
    expect(within(textEl).queryByRole('img')).toBeNull();
  });

  it('renders a <script> injection as literal text, not an executable node', () => {
    const script = '<script>alert(1)</script>';
    const { container } = render(
      <ChatMessage message={{ sender: 'host', text: script }} selfRole="host" />,
    );
    expect(screen.getByTestId('chat-message-text').textContent).toBe(script);
    expect(container.querySelector('script')).toBeNull();
  });
});
