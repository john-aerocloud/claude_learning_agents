// @covers uc-s014-4
// @covers SteerPanel
// @covers CopyPromptButton
// @covers CopyToast
// UC-S014-4 — copy-to-clipboard + toast + PROMPT-FREEZE-1 (jsdom layer; the
// real-browser clipboard/GEO drive is e2e/steer-copy.spec.js). Pins:
//   - the copy button exists ONLY when a prompt is displayed (absent, not
//     disabled, otherwise) and sits INSIDE prompt-output-slot AFTER the <pre>
//     (tab order: prompt → copy — S14-4-A11Y-1);
//   - PROMPT-COPY-1: the clipboard payload is byte-equal to the <pre>
//     textContent AND the `prompt` prop — same bytes the operator reviewed;
//   - success cues: button label flips to "Copied ✓" (accessible name still
//     matches /copy/i — stable selector), toast role="status" aria-live=
//     "polite" "Copied to clipboard", portalled (zero flow height), never
//     steals focus (S14-4-A11Y-2/3/7);
//   - auto-dismiss: toast hides + label reverts after the dismiss window; a
//     second click re-copies and re-shows (no misleading stale "Copied ✓");
//   - a FAILED clipboard write shows NO success cue (the UI never lies);
//   - PROMPT-FREEZE-1 (container): an SSE context refresh updates the context
//     block ONLY — the displayed prompt is byte-identical until an explicit
//     Generate press; the ContextRefreshCue flips live → updated → live.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact';
import { SteerPanel, SteerPanelContainer } from '../SteerPanel.jsx';
import { buildPrompt } from '../../lib/promptBuilder.js';

const CTX = {
  id: 'CHK-5',
  job: 'Compose a structured preview-first prompt',
  state: 'planned',
  value: 'HIGH',
  cost: 'M',
  sourceRef: 'work/demo/items/items.csv#id=CHK-5',
};

const baseProps = (over = {}) => ({
  itemId: 'CHK-5',
  actionType: 'raise-defect',
  status: 'ready',
  context: CTX,
  onCancel: vi.fn(),
  ...over,
});

let writeText;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  delete globalThis.navigator.clipboard;
});

/** Flush the clipboard promise chain (several microtask ticks) inside act. */
const flush = () => act(async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
});

describe('CopyPromptButton — presence + payload (PROMPT-COPY-1)', () => {
  it('is ABSENT (not disabled) while no prompt is displayed', () => {
    render(<SteerPanel {...baseProps()} />);
    expect(screen.queryByTestId('copy-prompt-btn')).toBeNull();
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull();
  });

  it('sits INSIDE prompt-output-slot, AFTER the <pre> in document order (S14-4-A11Y-1 tab order)', () => {
    const prompt = buildPrompt('raise-defect', CTX, 'note');
    render(<SteerPanel {...baseProps({ prompt })} />);
    const slot = screen.getByTestId('prompt-output-slot');
    const pre = screen.getByTestId('prompt-output');
    const btn = screen.getByTestId('copy-prompt-btn');
    expect(slot.contains(btn)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(pre.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON'); // native Enter+Space activation
  });

  it('copies EXACTLY the displayed bytes: clipboard === <pre> textContent === prompt prop', async () => {
    const prompt = buildPrompt('raise-defect', CTX, 'the wait badge shows 0 overnight');
    render(<SteerPanel {...baseProps({ prompt })} />);
    fireEvent.click(screen.getByTestId('copy-prompt-btn'));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0];
    expect(payload).toBe(prompt);
    expect(payload).toBe(screen.getByTestId('prompt-output').textContent);
  });
});

describe('CopyPromptButton + CopyToast — success cues (S14-4-A11Y-2/3/7, FIG-1)', () => {
  const renderAndCopy = async () => {
    const prompt = buildPrompt('custom', CTX, 'note');
    render(<SteerPanel {...baseProps({ prompt })} />);
    const btn = screen.getByTestId('copy-prompt-btn');
    btn.focus();
    fireEvent.click(btn);
    await flush();
    return btn;
  };

  it('flips the label to "Copied ✓" — accessible name still matches /copy/i (stable selector), ✓ aria-hidden', async () => {
    const btn = await renderAndCopy();
    expect(btn.textContent).toMatch(/copied/i);
    // selector stable across both states
    expect(screen.getByRole('button', { name: /cop/i })).toBe(btn);
    const glyph = btn.querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(glyph.textContent).toContain('✓');
  });

  it('shows the toast: role="status" aria-live="polite", human text, portalled to body', async () => {
    await renderAndCopy();
    const toast = screen.getByTestId('copy-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.textContent).toMatch(/copied to clipboard/i); // S14-4-FIG-1: words, not codes/bytes
    expect(toast.textContent).not.toMatch(/\d+\s*bytes?/i);
    expect(toast.parentElement).toBe(document.body); // portalled — zero flow height
  });

  it('NEVER steals focus: activeElement stays the copy button when the toast appears (A11Y-7)', async () => {
    const btn = await renderAndCopy();
    expect(screen.getByTestId('copy-toast')).toBeTruthy();
    expect(document.activeElement).toBe(btn);
  });

  it('auto-dismisses and reverts the label after the dismiss window; a second click re-copies + re-shows', async () => {
    vi.useFakeTimers();
    try {
      const prompt = buildPrompt('custom', CTX, 'note');
      render(<SteerPanel {...baseProps({ prompt })} />);
      const btn = screen.getByTestId('copy-prompt-btn');
      fireEvent.click(btn);
      await act(() => vi.advanceTimersByTimeAsync(0)); // flush clipboard microtasks
      expect(screen.getByTestId('copy-toast')).toBeTruthy();

      await act(() => vi.advanceTimersByTimeAsync(5000)); // > --dur-toast window
      expect(screen.queryByTestId('copy-toast')).toBeNull();
      expect(btn.textContent).toMatch(/copy prompt/i); // reverted — no stale "Copied ✓"

      fireEvent.click(btn);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(writeText).toHaveBeenCalledTimes(2); // re-copies, not a no-op
      expect(screen.getByTestId('copy-toast')).toBeTruthy(); // re-shows
    } finally {
      vi.useRealTimers();
    }
  });

  it('a FAILED clipboard write shows NO success cue (no toast, no label flip — the UI never lies)', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const prompt = buildPrompt('custom', CTX, 'note');
    render(<SteerPanel {...baseProps({ prompt })} />);
    const btn = screen.getByTestId('copy-prompt-btn');
    fireEvent.click(btn);
    await flush();
    await flush();
    expect(screen.queryByTestId('copy-toast')).toBeNull();
    expect(btn.textContent).toMatch(/copy prompt/i);
  });
});

describe('SteerPanelContainer — PROMPT-FREEZE-1 + ContextRefreshCue (EXP-036)', () => {
  const ROW_V1 = { id: 'CHK-5', job: CTX.job, state: 'planned', value: 'HIGH', cost: 'M' };
  const ROW_V2 = { ...ROW_V1, state: 'in-progress' };

  const mountLive = async () => {
    let onChange;
    let rows = [ROW_V1];
    const loadItems = vi.fn(() => Promise.resolve(rows));
    render(
      <SteerPanelContainer
        itemId="CHK-5"
        actionType="raise-defect"
        project="demo"
        loadItems={loadItems}
        subscribe={(cb) => { onChange = cb; return () => {}; }}
        debounceMs={0}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('steer-context')).toBeTruthy());
    return {
      loadItems,
      fireChange: () => onChange({ type: 'change', path: 'work/demo/items/items.csv' }),
      setRows: (r) => { rows = r; },
    };
  };

  const generate = async (intent = 'split the copy step out') => {
    fireEvent.input(screen.getByTestId('intent-note'), { target: { value: intent } });
    fireEvent.click(screen.getByTestId('steer-generate'));
    await screen.findByTestId('prompt-output');
  };

  it('PROMPT-FREEZE-1: an SSE refresh updates the context block ONLY — the prompt is byte-identical until Generate', async () => {
    const { setRows, fireChange } = await mountLive();
    await generate();
    const before = screen.getByTestId('prompt-output').textContent;
    expect(before).toContain('planned');

    setRows([ROW_V2]);
    fireChange();
    // context block re-renders in place to the new state…
    await waitFor(() =>
      expect(screen.getByTestId('steer-ctx-state').textContent).toBe('in-progress'));
    // …but the displayed prompt did NOT move (frozen — operator's reviewed bytes)
    expect(screen.getByTestId('prompt-output').textContent).toBe(before);

    // an EXPLICIT Generate press regenerates from the refreshed context
    fireEvent.click(screen.getByTestId('steer-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('prompt-output').textContent).toContain('in-progress'));
  });

  it('ContextRefreshCue: live → updated (with the regenerate sentence) → live again after Generate', async () => {
    const { setRows, fireChange } = await mountLive();
    const cue = screen.getByTestId('steer-context-live');
    expect(cue.getAttribute('role')).toBe('status'); // announce-once (A11Y-8)
    expect(cue.getAttribute('aria-live')).toBe('polite');
    expect(cue.getAttribute('data-state')).toBe('live');

    await generate();
    setRows([ROW_V2]);
    fireChange();
    await waitFor(() =>
      expect(screen.getByTestId('steer-context-live').getAttribute('data-state')).toBe('updated'));
    // the operative EXP-036 signal — a human sentence, not a frame id (FIG-2)
    expect(screen.getByTestId('steer-context-live').textContent)
      .toMatch(/context updated — regenerate to refresh the prompt/i);

    fireEvent.click(screen.getByTestId('steer-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('steer-context-live').getAttribute('data-state')).toBe('live'));
  });

  it('a refresh that does NOT change the context keeps the cue live (no false "updated" alarm)', async () => {
    const { fireChange, loadItems } = await mountLive();
    await generate();
    fireChange(); // same rows re-fetched
    await waitFor(() => expect(loadItems).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('steer-context-live').getAttribute('data-state')).toBe('live');
  });
});
