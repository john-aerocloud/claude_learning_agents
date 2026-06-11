// @covers uc-s015-3
// @covers ReslicePreviewPanel
// @covers UseReslicePreview
// @covers UseSteerContext
// UC-S015-3 — ReslicePreviewPanel: the two-column before/after re-slice
// preview drawer (jsdom half; geometry/axe pins live in e2e/reslice-preview.spec.js).
//
// A SIBLING of SteerPanel in the same drawer family (style reuse, NOT
// component composition). PREVIEW-ONLY: writes nothing; Generate's only
// output is the onGenerate call carrying the UC-S015-4 handoff seam.
//
// Pins:
//   F-S3-1   panel renders with two visible columns "Current item" / "Proposed split"
//   F-S3-2   Before column = the useSteerContext six-field contract VERBATIM,
//            labelled dt/dd, no raw CSV keys (S15-3-FIG-1, S15-3-A11Y-7)
//   F-S3-3   Part A / Part B accept free text (container: no write, no re-fetch)
//   F-S3-4   Generate aria-disabled until Part A + Part B + intent all non-empty
//   F-S3-5   Cancel/×/Esc call onCancel without generating
//   FIG-3    cost note ABSENT until both parts non-empty; prompt-output ABSENT
//            always (the slot is pinned EMPTY until UC-S015-4)
//   FIG-4    not-found renders "Item <id> not found", no crash
//   A11Y-2   focus moves to the heading on open, returns to opener on close
//   A11Y-5/8 dialog NON-modal named "Re-slice / split: <id>"; h2 → two h3s
//   RESLICE-PREVIEW-1  onGenerate({itemId, context, partAJob, partBJob, intentNote})
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import {
  ReslicePreviewPanel,
  ReslicePreviewPanelContainer,
} from '../ReslicePreviewPanel.jsx';
import { RESLICE_COST_NOTE } from '../../hooks/useReslicePreview.js';

const CONTEXT = {
  id: 'CHK-1',
  job: 'First demo chunk',
  state: 'in progress',
  value: 'HIGH',
  cost: 'M',
  sourceRef: 'work/demo/items/items.csv#id=CHK-1',
};

/** Pure-render props for a ready panel (state pinned by the caller). */
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

const ITEMS = [
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'First demo chunk', state: 'in_progress', value: 'HIGH', cost: 'M' },
];

describe('ReslicePreviewPanel (pure render)', () => {
  it('F-S3-1 / S15-3-A11Y-5: a non-modal dialog named "Re-slice / split: <id>" with the two column headings', () => {
    render(<ReslicePreviewPanel {...readyProps()} />);
    const panel = screen.getByTestId('reslice-preview-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.hasAttribute('aria-modal')).toBe(false); // NON-modal — no trap, no scrim
    expect(panel.getAttribute('data-item-id')).toBe('CHK-1');
    expect(screen.getByRole('dialog', { name: /re-slice.*: CHK-1/i })).toBeTruthy();
    // two visible columns, headed
    expect(within(screen.getByTestId('reslice-before')).getByText('Current item')).toBeTruthy();
    expect(within(screen.getByTestId('reslice-after')).getByText('Proposed split')).toBeTruthy();
  });

  it('S15-3-A11Y-8: heading levels are h2 (panel) then h3 (columns) — no skipped levels', () => {
    render(<ReslicePreviewPanel {...readyProps()} />);
    const panel = screen.getByTestId('reslice-preview-panel');
    const h2 = panel.querySelectorAll('h2');
    expect(h2.length).toBe(1);
    expect(h2[0].textContent).toBe('Re-slice / split: CHK-1');
    const h3 = [...panel.querySelectorAll('h3')].map((h) => h.textContent);
    expect(h3).toEqual(['Current item', 'Proposed split']);
    expect(panel.querySelectorAll('h4, h5, h6').length).toBe(0);
  });

  it('F-S3-2 / S15-3-FIG-1 / A11Y-7: Before column renders the six-field contract verbatim as labelled dt/dd pairs', () => {
    render(<ReslicePreviewPanel {...readyProps()} />);
    const before = screen.getByTestId('reslice-before');
    // provenance anchor (SourceLink convention)
    expect(before.getAttribute('data-source')).toBe(CONTEXT.sourceRef);
    // id never alone — "CHK-1 — <job sentence>" (§3)
    expect(screen.getByTestId('reslice-before-id').textContent).toBe('CHK-1 — First demo chunk');
    expect(screen.getByTestId('reslice-before-job').textContent).toBe('First demo chunk');
    expect(screen.getByTestId('reslice-before-value').textContent).toBe('HIGH');
    expect(screen.getByTestId('reslice-before-cost').textContent).toBe('M');
    // human state label, never the raw enum/CSV key
    expect(screen.getByTestId('reslice-before-stage').textContent).toBe('in progress');
    // every value is a <dd> with a preceding <dt> label (announced never bare)
    for (const f of ['id', 'job', 'value', 'cost', 'stage']) {
      const dd = screen.getByTestId(`reslice-before-${f}`);
      expect(dd.tagName).toBe('DD');
    }
    const dts = [...before.querySelectorAll('dt')].map((d) => d.textContent);
    expect(dts).toEqual(['Item', 'Job', 'Value', 'Cost', 'Current stage']);
    // no raw CSV keys anywhere in the panel (S15-3-FIG-1)
    const text = screen.getByTestId('reslice-preview-panel').textContent;
    for (const raw of ['vc_ratio', 'done_ts', 'started_ts', 'sourceRef', 'part_a_job']) {
      expect(text).not.toContain(raw);
    }
    // the replaced-by expectation note
    expect(screen.getByTestId('reslice-before-note').textContent)
      .toBe('After split, this item will be replaced by Part A and Part B');
  });

  it('S15-3-FIG-2: After fields are labelled in human words with human placeholders', () => {
    render(<ReslicePreviewPanel {...readyProps()} />);
    const partA = screen.getByRole('textbox', { name: /part a job/i });
    const partB = screen.getByRole('textbox', { name: /part b job/i });
    expect(partA.getAttribute('data-testid')).toBe('part-a-job');
    expect(partB.getAttribute('data-testid')).toBe('part-b-job');
    expect(partA.getAttribute('placeholder')).toBe('Describe what Part A will deliver…');
    expect(partB.getAttribute('placeholder')).toBe('Describe what Part B will deliver…');
    // intent textarea labelled with the human question
    const intent = screen.getByRole('textbox', { name: /why.*splitting|intent/i });
    expect(intent.getAttribute('data-testid')).toBe('reslice-intent');
  });

  it('S15-3-FIG-3: cost note ABSENT with empty parts, PRESENT when given; prompt slot pinned EMPTY', () => {
    const { rerender } = render(<ReslicePreviewPanel {...readyProps()} />);
    expect(screen.queryByTestId('reslice-cost-note')).toBeNull();
    // the reserved output slot exists and is EMPTY (UC-S015-4 boundary)
    const slot = screen.getByTestId('prompt-output-slot');
    expect(slot.children.length).toBe(0);
    expect(screen.queryByTestId('prompt-output')).toBeNull();
    rerender(
      <ReslicePreviewPanel
        {...readyProps({ partAJob: 'a', partBJob: 'b', costNote: RESLICE_COST_NOTE })}
      />,
    );
    expect(screen.getByTestId('reslice-cost-note').textContent).toBe(RESLICE_COST_NOTE);
    expect(screen.queryByTestId('prompt-output')).toBeNull();
  });

  it('F-S3-4: Generate is aria-disabled while guarded and activation is a no-op', () => {
    const props = readyProps();
    render(<ReslicePreviewPanel {...props} />);
    const gen = screen.getByTestId('reslice-generate');
    expect(gen.textContent).toBe('Looks right — generate prompt');
    expect(gen.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gen);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it('RESLICE-PREVIEW-1: when enabled, Generate fires onGenerate with the UC-S015-4 handoff seam', () => {
    const props = readyProps({
      partAJob: 'Part A reads',
      partBJob: 'Part B writes',
      intentNote: 'too big',
      canGenerate: true,
      costNote: RESLICE_COST_NOTE,
    });
    render(<ReslicePreviewPanel {...props} />);
    const gen = screen.getByTestId('reslice-generate');
    expect(gen.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(gen);
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).toHaveBeenCalledWith({
      itemId: 'CHK-1',
      context: CONTEXT,
      partAJob: 'Part A reads',
      partBJob: 'Part B writes',
      intentNote: 'too big',
    });
    // generating renders NO prompt here — the slot stays empty (UC-S015-4)
    expect(screen.queryByTestId('prompt-output')).toBeNull();
  });

  it('F-S3-5: Cancel, × and Esc each call onCancel', () => {
    const props = readyProps();
    render(<ReslicePreviewPanel {...props} />);
    fireEvent.click(screen.getByTestId('reslice-cancel'));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /close re-slice preview/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByTestId('reslice-preview-panel'), { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(3);
  });

  it('S15-3-A11Y-1: keyboard order is Part A → Part B → intent → Generate → Cancel → × (× last in DOM)', () => {
    render(<ReslicePreviewPanel {...readyProps()} />);
    const panel = screen.getByTestId('reslice-preview-panel');
    const order = [...panel.querySelectorAll('textarea, button')].map(
      (el) => el.getAttribute('data-testid'),
    );
    expect(order).toEqual([
      'part-a-job', 'part-b-job', 'reslice-intent',
      'reslice-generate', 'reslice-cancel', 'reslice-close',
    ]);
  });

  it('S15-3-A11Y-2: focus moves to the heading on open and RETURNS to the opener on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<ReslicePreviewPanel {...readyProps()} />);
    const heading = screen.getByTestId('reslice-heading');
    expect(document.activeElement).toBe(heading);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('GEO-S015-3-1 (jsdom half): the panel is portalled to document.body, not nested in a host surface', () => {
    render(<div data-testid="host"><ReslicePreviewPanel {...readyProps()} /></div>);
    const panel = screen.getByTestId('reslice-preview-panel');
    expect(panel.parentElement).toBe(document.body);
    expect(screen.getByTestId('host').contains(panel)).toBe(false);
  });

  it('S15-3-FIG-4: not-found renders the labelled fail-soft state; After + Generate hidden, Cancel/× remain', () => {
    render(
      <ReslicePreviewPanel {...readyProps({ status: 'not-found', context: null, itemId: 'NOPE-9' })} />,
    );
    expect(screen.getByTestId('reslice-context-notfound').textContent).toBe('Item NOPE-9 not found');
    expect(screen.queryByTestId('reslice-after')).toBeNull();
    expect(screen.queryByTestId('reslice-generate')).toBeNull();
    expect(screen.getByTestId('reslice-cancel')).toBeTruthy();
    expect(screen.getByRole('button', { name: /close re-slice preview/i })).toBeTruthy();
  });

  it('loading state: Before shows the placeholder; After fields are disabled; Generate guarded', () => {
    render(<ReslicePreviewPanel {...readyProps({ status: 'loading', context: null })} />);
    expect(screen.getByTestId('reslice-context-loading').textContent).toBe('Loading item context…');
    expect(screen.getByTestId('part-a-job').disabled).toBe(true);
    expect(screen.getByTestId('part-b-job').disabled).toBe(true);
    expect(screen.getByTestId('reslice-intent').disabled).toBe(true);
    expect(screen.getByTestId('reslice-generate').getAttribute('aria-disabled')).toBe('true');
  });

  it('error state: labelled retry message; After + Generate hidden', () => {
    render(<ReslicePreviewPanel {...readyProps({ status: 'error', context: null })} />);
    expect(screen.getByTestId('reslice-context-error').textContent)
      .toBe('Could not load item context — try again');
    expect(screen.queryByTestId('reslice-after')).toBeNull();
    expect(screen.queryByTestId('reslice-generate')).toBeNull();
  });
});

describe('ReslicePreviewPanelContainer (hook wiring)', () => {
  function renderContainer(over = {}) {
    const onCancel = vi.fn();
    const onGenerate = vi.fn();
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(
      <ReslicePreviewPanelContainer
        itemId="CHK-1"
        project="demo"
        loadItems={loadItems}
        onCancel={onCancel}
        onGenerate={onGenerate}
        {...over}
      />,
    );
    return { onCancel, onGenerate, loadItems };
  }

  it('resolves the item context through useSteerContext and renders the Before column verbatim', async () => {
    renderContainer();
    await waitFor(() =>
      expect(screen.getByTestId('reslice-before-id').textContent).toBe('CHK-1 — First demo chunk'));
    // humanised state (underscores read as spaces) — the SAME transform SteerPanel shows
    expect(screen.getByTestId('reslice-before-stage').textContent).toBe('in progress');
    expect(screen.getByTestId('reslice-before').getAttribute('data-source'))
      .toBe('work/demo/items/items.csv#id=CHK-1');
  });

  it('F-S3-3/F-S3-4: typing flips the guard only when all three fields are non-empty; no re-fetch, no write', async () => {
    const { loadItems } = renderContainer();
    // wait for status=ready (fields enabled), not just the column shell
    await waitFor(() => expect(screen.getByTestId('part-a-job').disabled).toBe(false));
    expect(screen.getByTestId('reslice-generate').getAttribute('aria-disabled')).toBe('true');
    const calls = loadItems.mock.calls.length;
    fireEvent.input(screen.getByTestId('part-a-job'), { target: { value: 'Part A reads' } });
    fireEvent.input(screen.getByTestId('part-b-job'), { target: { value: 'Part B writes' } });
    expect(screen.getByTestId('reslice-generate').getAttribute('aria-disabled')).toBe('true');
    // both parts non-empty → the directional cost note appears (FIG-3)
    expect(screen.getByTestId('reslice-cost-note').textContent).toBe(RESLICE_COST_NOTE);
    fireEvent.input(screen.getByTestId('reslice-intent'), { target: { value: 'too big' } });
    expect(screen.getByTestId('reslice-generate').getAttribute('aria-disabled')).toBe('false');
    expect(loadItems.mock.calls.length).toBe(calls); // typing fetches nothing
  });

  it('RESLICE-PREVIEW-1: Generate hands the container onGenerate the full seam and writes nothing', async () => {
    const { onGenerate } = renderContainer();
    // status=ready required: the Before figures are rendered and fields enabled
    await waitFor(() =>
      expect(screen.getByTestId('reslice-before-id').textContent).toBe('CHK-1 — First demo chunk'));
    fireEvent.input(screen.getByTestId('part-a-job'), { target: { value: 'A' } });
    fireEvent.input(screen.getByTestId('part-b-job'), { target: { value: 'B' } });
    fireEvent.input(screen.getByTestId('reslice-intent'), { target: { value: 'why' } });
    fireEvent.click(screen.getByTestId('reslice-generate'));
    expect(onGenerate).toHaveBeenCalledTimes(1);
    const seam = onGenerate.mock.calls[0][0];
    expect(seam.itemId).toBe('CHK-1');
    expect(seam.partAJob).toBe('A');
    expect(seam.partBJob).toBe('B');
    expect(seam.intentNote).toBe('why');
    expect(seam.context.id).toBe('CHK-1');
    expect(seam.context.sourceRef).toBe('work/demo/items/items.csv#id=CHK-1');
    // the slot is STILL empty after Generate (prompt rendering is UC-S015-4)
    expect(screen.queryByTestId('prompt-output')).toBeNull();
  });

  it('S15-3-FIG-4: an unknown id renders not-found, never a crash', async () => {
    renderContainer({ itemId: 'GHOST-1' });
    await waitFor(() =>
      expect(screen.getByTestId('reslice-context-notfound').textContent).toBe('Item GHOST-1 not found'));
    expect(screen.queryByTestId('reslice-after')).toBeNull();
  });
});
