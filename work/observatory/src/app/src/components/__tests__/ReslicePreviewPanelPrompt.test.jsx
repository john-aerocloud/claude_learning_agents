// @covers uc-s015-4
// @covers ReslicePreviewPanel
// @covers PromptBuilder
// @covers CopyPromptButton
// @covers CopyToast
// UC-S015-4 — the enriched re-slice/split prompt rendered into the panel's
// reserved output slot (jsdom half; the real-browser clipboard/GEO drive is
// e2e/reslice-prompt.spec.js). The UC-S014-4 idiom is INHERITED into THIS
// panel — same delivered components (CopyPromptButton, CopyToast), same
// PromptOutput presentation, same PROMPT-FREEZE discipline. Pins:
//   AC-1/2   Generate renders the enriched prompt: item id + job (before),
//            Part A + Part B (after), intent verbatim, the /slice-next form
//            with the labelled "Proposed split:" block
//   AC-4     prompt generation is client-side only — no fetch, no write
//   PROMPT-COPY-1   the copy button copies the EXACT displayed bytes; toast
//            is a polite status region; both ABSENT until a prompt exists
//   PROMPT-FREEZE-1 an SSE context refresh updates the Before column ONLY —
//            the displayed prompt is byte-identical until an explicit
//            re-Generate
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/preact';
import {
  ReslicePreviewPanel,
  ReslicePreviewPanelContainer,
} from '../ReslicePreviewPanel.jsx';
import { buildPrompt } from '../../lib/promptBuilder.js';

const CONTEXT = {
  id: 'CHK-1',
  job: 'First demo chunk',
  state: 'in progress',
  value: 'HIGH',
  cost: 'M',
  sourceRef: 'work/demo/items/items.csv#id=CHK-1',
};

const PARTS = { partAJob: 'Part A reads', partBJob: 'Part B writes' };
const INTENT = 'too big to flow as one item';

const ROW_V1 = { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'First demo chunk', state: 'in_progress', value: 'HIGH', cost: 'M' };
const ROW_V2 = { ...ROW_V1, state: 'done' };

function readyProps(overrides = {}) {
  return {
    itemId: 'CHK-1',
    status: 'ready',
    context: CONTEXT,
    partAJob: '',
    partBJob: '',
    intentNote: '',
    canGenerate: false,
    costNote: null,
    onPartAChange: vi.fn(),
    onPartBChange: vi.fn(),
    onIntentChange: vi.fn(),
    onCancel: vi.fn(),
    onGenerate: vi.fn(),
    ...overrides,
  };
}

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

describe('ReslicePreviewPanel — prompt output slot (UC-S015-4, the s014 PromptOutput idiom)', () => {
  const PROMPT = buildPrompt('re-slice', CONTEXT, INTENT, PARTS);

  it('renders the prompt prop as a selectable <pre> INSIDE prompt-output-slot, byte-equal', () => {
    render(<ReslicePreviewPanel {...readyProps({ prompt: PROMPT })} />);
    const slot = screen.getByTestId('prompt-output-slot');
    const pre = screen.getByTestId('prompt-output');
    expect(slot.contains(pre)).toBe(true);
    expect(pre.tagName).toBe('PRE'); // whitespace-exact, selectable presentation
    expect(pre.className).toContain('prompt-output'); // the s014 mono/40vh/selectable CSS
    expect(pre.getAttribute('aria-label')).toBe('Generated prompt');
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.textContent).toBe(PROMPT); // the rendered bytes ARE the handoff
  });

  it('the copy button sits INSIDE the slot AFTER the <pre>; both ABSENT without a prompt', () => {
    const { unmount } = render(<ReslicePreviewPanel {...readyProps({ prompt: PROMPT })} />);
    const slot = screen.getByTestId('prompt-output-slot');
    const pre = screen.getByTestId('prompt-output');
    const btn = screen.getByTestId('copy-prompt-btn');
    expect(slot.contains(btn)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(pre.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();
    render(<ReslicePreviewPanel {...readyProps()} />);
    expect(screen.queryByTestId('prompt-output')).toBeNull();
    expect(screen.queryByTestId('copy-prompt-btn')).toBeNull(); // absent, never disabled
  });

  it('PROMPT-COPY-1: copy puts the EXACT displayed bytes on the clipboard and shows the polite toast', async () => {
    render(<ReslicePreviewPanel {...readyProps({ prompt: PROMPT })} />);
    fireEvent.click(screen.getByTestId('copy-prompt-btn'));
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toBe(PROMPT);
    expect(writeText.mock.calls[0][0]).toBe(screen.getByTestId('prompt-output').textContent);
    const toast = screen.getByTestId('copy-toast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.textContent).toMatch(/copied to clipboard/i);
    expect(toast.parentElement).toBe(document.body); // portalled — zero flow height
  });

  it('the toast auto-dismisses after the --dur-toast window (the panel owns the timer)', async () => {
    vi.useFakeTimers();
    try {
      render(<ReslicePreviewPanel {...readyProps({ prompt: PROMPT })} />);
      fireEvent.click(screen.getByTestId('copy-prompt-btn'));
      await act(() => vi.advanceTimersByTimeAsync(0)); // flush clipboard microtasks
      expect(screen.getByTestId('copy-toast')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(5000)); // > --dur-toast
      expect(screen.queryByTestId('copy-toast')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keyboard order is unchanged ahead of the slot; the prompt <pre> and copy button trail the × in DOM', () => {
    render(<ReslicePreviewPanel {...readyProps({ prompt: PROMPT })} />);
    const panel = screen.getByTestId('reslice-preview-panel');
    const order = [...panel.querySelectorAll('textarea, button, pre')].map(
      (el) => el.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'part-a-job', 'part-b-job', 'reslice-intent',
      'reslice-generate', 'reslice-cancel',
      'prompt-output', 'copy-prompt-btn', 'reslice-close',
    ]);
  });
});

describe('ReslicePreviewPanelContainer — Generate renders the enriched prompt (UC-S015-4)', () => {
  function mountLive(over = {}) {
    let onChange;
    let rows = [ROW_V1];
    const loadItems = vi.fn(() => Promise.resolve(rows));
    const onGenerate = vi.fn();
    render(
      <ReslicePreviewPanelContainer
        itemId="CHK-1"
        project="demo"
        loadItems={loadItems}
        subscribe={(cb) => { onChange = cb; return () => {}; }}
        debounceMs={0}
        onCancel={vi.fn()}
        onGenerate={onGenerate}
        {...over}
      />,
    );
    return {
      loadItems,
      onGenerate,
      fireChange: () => onChange({ type: 'change', path: 'work/demo/items/items.csv' }),
      setRows: (r) => { rows = r; },
    };
  }

  async function fillAndGenerate() {
    await waitFor(() => expect(screen.getByTestId('part-a-job').disabled).toBe(false));
    fireEvent.input(screen.getByTestId('part-a-job'), { target: { value: PARTS.partAJob } });
    fireEvent.input(screen.getByTestId('part-b-job'), { target: { value: PARTS.partBJob } });
    fireEvent.input(screen.getByTestId('reslice-intent'), { target: { value: INTENT } });
    fireEvent.click(screen.getByTestId('reslice-generate'));
    await screen.findByTestId('prompt-output');
  }

  it('AC-1/AC-2: the rendered prompt carries all five fields verbatim + the /slice-next "Proposed split:" form', async () => {
    mountLive();
    await fillAndGenerate();
    const out = screen.getByTestId('prompt-output').textContent;
    expect(out).toMatch(/^\/slice-next\b/);
    expect(out).toContain('CHK-1 — First demo chunk'); // before: id WITH job
    expect(out).toContain(`Part A: ${PARTS.partAJob}`); // after
    expect(out).toContain(`Part B: ${PARTS.partBJob}`); // after
    expect(out).toContain(INTENT); // operator intent verbatim
    expect(out).toContain('Proposed split:');
    // byte-equal to the pure builder over the SAME context the Before column shows
    const expected = buildPrompt(
      're-slice',
      { ...CONTEXT, state: 'in progress' },
      INTENT,
      PARTS,
    );
    expect(out).toBe(expected);
    expect(out).not.toMatch(/\{\{[^}]*\}\}/); // no token residue
  });

  it('AC-4: generation is client-side only — no re-fetch, no write; the caller seam still fires', async () => {
    const { loadItems, onGenerate } = mountLive();
    await fillAndGenerate();
    expect(loadItems).toHaveBeenCalledTimes(1); // the initial context load only
    expect(onGenerate).toHaveBeenCalledTimes(1); // UC-S015-3 contract preserved
  });

  it('PROMPT-FREEZE-1: an SSE context refresh updates the Before column ONLY — the prompt is byte-identical until re-Generate', async () => {
    const { setRows, fireChange } = mountLive();
    await fillAndGenerate();
    const before = screen.getByTestId('prompt-output').textContent;
    expect(before).toContain('in progress');

    setRows([ROW_V2]);
    fireChange();
    // the Before column re-renders in place to the new state…
    await waitFor(() =>
      expect(screen.getByTestId('reslice-before-stage').textContent).toBe('done'));
    // …but the displayed prompt did NOT move (frozen — the operator's reviewed bytes)
    expect(screen.getByTestId('prompt-output').textContent).toBe(before);

    // an EXPLICIT re-Generate regenerates from the refreshed context
    fireEvent.click(screen.getByTestId('reslice-generate'));
    await waitFor(() =>
      expect(screen.getByTestId('prompt-output').textContent).toContain('done'));
  });
});
