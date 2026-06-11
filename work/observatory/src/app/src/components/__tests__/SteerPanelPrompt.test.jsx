// @covers uc-s014-3
// @covers SteerPanel
// @covers PromptBuilder
// UC-S014-3 — prompt output wired into the SteerPanel slot. UC-S014-2's spec
// file is untouched (its done-condition excluded the prompt); this file owns
// the UC-S014-3 surface:
//   - SteerPanel renders a `prompt` prop into the RESERVED slot
//     (data-testid="prompt-output-slot") as a read-only, SELECTABLE
//     data-testid="prompt-output" element; no prompt → slot stays empty;
//   - SteerPanelContainer wires onGenerate: click Generate → buildPrompt
//     (pure, client-side) → prompt visible in the slot containing the item's
//     human refs (id + job), the action's slash-command verb, and the
//     operator's intent VERBATIM;
//   - AC-3: output non-empty well under 500 ms of the click (jsdom, measured);
//   - AC-4: generation makes NO server request (the injected items loader is
//     called once for context fetch, never again on generate);
//   - PIN FLIPPED (UC-S014-4 pin-flip ledger, ui-design.md): this file
//     originally pinned the copy button ABSENT; UC-S014-4 REPLACED that pin
//     with the present-assertion below (copy button accompanies the prompt) —
//     the full copy behaviour lives in SteerPanelCopy.test.jsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
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

const ITEMS = [
  { id: 'CHK-5', job: CTX.job, state: 'planned', value: 'HIGH', cost: 'M' },
];

const baseProps = (over = {}) => ({
  itemId: 'CHK-5',
  actionType: 'raise-defect',
  status: 'ready',
  context: CTX,
  onCancel: vi.fn(),
  ...over,
});

describe('SteerPanel — prompt output rendering (UC-S014-3)', () => {
  it('renders the prompt prop into the reserved slot as selectable text', () => {
    const prompt = buildPrompt('raise-defect', CTX, 'chips render stale wait times');
    render(<SteerPanel {...baseProps({ prompt })} />);
    const out = screen.getByTestId('prompt-output');
    // lives INSIDE the UC-S014-2 reserved slot
    expect(screen.getByTestId('prompt-output-slot').contains(out)).toBe(true);
    expect(out.textContent).toBe(prompt); // exact, byte-for-byte — operator pastes this
    // selectable text, not an input: a <pre> keeps whitespace + slash-command lines
    expect(out.tagName).toBe('PRE');
    expect(out.getAttribute('aria-label')).toMatch(/generated prompt/i);
  });

  it('renders NO prompt-output element while no prompt has been generated', () => {
    render(<SteerPanel {...baseProps()} />);
    expect(screen.getByTestId('prompt-output-slot').children.length).toBe(0);
    expect(screen.queryByTestId('prompt-output')).toBeNull();
  });

  it('PIN FLIPPED (UC-S014-4): the copy button now accompanies a displayed prompt', () => {
    // Was: "has NO copy button — clipboard copy is UC-S014-4, not built here"
    // (queryByTestId('copy-prompt-btn') null). Flipped per the UC-S014-4
    // pin-flip ledger — replaced, not silently deleted. Full copy behaviour
    // (payload, toast, focus, dismiss) is pinned in SteerPanelCopy.test.jsx.
    const prompt = buildPrompt('custom', CTX, 'note');
    render(<SteerPanel {...baseProps({ prompt })} />);
    expect(screen.getByTestId('copy-prompt-btn')).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });
});

describe('SteerPanelContainer — Generate wires promptBuilder into the slot (UC-S014-3)', () => {
  const mountAndGenerate = async (actionType, intent) => {
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(
      <SteerPanelContainer
        itemId="CHK-5"
        actionType={actionType}
        project="demo"
        loadItems={loadItems}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('steer-context')).toBeTruthy());
    fireEvent.input(screen.getByTestId('intent-note'), { target: { value: intent } });
    const t0 = performance.now();
    fireEvent.click(screen.getByTestId('steer-generate'));
    return { loadItems, t0 };
  };

  it('click Generate → filled prompt visible: human refs + slash verb + intent verbatim (AC-1)', async () => {
    const intent = 'the wait badge shows 0 for items queued overnight';
    await mountAndGenerate('raise-defect', intent);
    const out = await screen.findByTestId('prompt-output');
    expect(out.textContent).toMatch(/^\/defect\b/);
    expect(out.textContent).toContain('CHK-5 — Compose a structured preview-first prompt');
    expect(out.textContent).toContain(intent); // operator's words, verbatim
    expect(out.textContent).toContain('Project: demo');
    expect(out.textContent).not.toMatch(/\{\{[^}]*\}\}/); // no token residue
  });

  it('renders within the AC-3 budget (<500 ms click → non-empty output)', async () => {
    const { t0 } = await mountAndGenerate('re-slice', 'split copy step out');
    const out = await screen.findByTestId('prompt-output');
    expect(out.textContent.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('generation is client-side only — no further server request on Generate (AC-4)', async () => {
    const { loadItems } = await mountAndGenerate('re-prioritise', 'bump above CHK-7');
    await screen.findByTestId('prompt-output');
    expect(loadItems).toHaveBeenCalledTimes(1); // context fetch only; generate fetched nothing
  });

  it('re-generating after editing the intent replaces the prompt with the new words', async () => {
    await mountAndGenerate('custom', 'first thought');
    await screen.findByTestId('prompt-output');
    fireEvent.input(screen.getByTestId('intent-note'), { target: { value: 'second thought' } });
    fireEvent.click(screen.getByTestId('steer-generate'));
    await waitFor(() => {
      const out = screen.getByTestId('prompt-output');
      expect(out.textContent).toContain('second thought');
      expect(out.textContent).not.toContain('first thought');
    });
  });

  it('still calls a caller-supplied onGenerate (UC-S014-2 contract preserved)', async () => {
    const onGenerate = vi.fn();
    const loadItems = vi.fn().mockResolvedValue(ITEMS);
    render(
      <SteerPanelContainer
        itemId="CHK-5"
        actionType="re-slice"
        project="demo"
        loadItems={loadItems}
        onCancel={vi.fn()}
        onGenerate={onGenerate}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('steer-context')).toBeTruthy());
    fireEvent.input(screen.getByTestId('intent-note'), { target: { value: 'split it' } });
    fireEvent.click(screen.getByTestId('steer-generate'));
    expect(onGenerate).toHaveBeenCalledWith('split it', expect.objectContaining({
      itemId: 'CHK-5',
      actionType: 're-slice',
    }));
  });
});
