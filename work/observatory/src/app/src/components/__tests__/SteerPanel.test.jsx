// @covers uc-s014-2
// @covers SteerPanel
// UC-S014-2 — SteerPanel: the right-anchored NON-MODAL floating drawer the
// SteerMenu opens. jsdom unit pins (GEO byte-identity + axe + real keyboard
// live in e2e/steer-panel.spec.js):
//   - dialog contract: role=dialog, NO aria-modal, named "Steer: <itemId>",
//     portalled to document.body, data-item-id/data-action (S14-2-A11Y-5)
//   - context block: six labelled dt/dd pairs, human labels/values, id shown
//     WITH the job sentence, action shown as the HUMAN label never the enum,
//     data-source anchor (S14-2-FIG-1/2, A11Y-7)
//   - FIG-3: absent source value renders "—", never blank/0/null/undefined
//   - states: loading skeleton (textarea disabled), not-found ("Item <id> not
//     found", textarea+Generate hidden), error ("Could not load…") — FIG-4
//   - Generate guard: aria-disabled until ≥1 char; no onGenerate while empty;
//     fires with the verbatim note (+ the context UC-S014-3 consumes) once typed
//   - close: × / Cancel / Esc call onCancel; no filesystem write path exists
//   - focus: heading focused on open; focus returns to the opener on unmount
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { SteerPanel } from '../SteerPanel.jsx';

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
  actionType: 're-slice',
  status: 'ready',
  context: CTX,
  onCancel: vi.fn(),
  onGenerate: vi.fn(),
  ...over,
});

describe('SteerPanel (UC-S014-2) — dialog contract', () => {
  it('renders a NON-MODAL dialog named "Steer: <itemId>", portalled to document.body', () => {
    render(<SteerPanel {...baseProps()} />);
    const panel = screen.getByTestId('steer-panel');
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.hasAttribute('aria-modal')).toBe(false); // non-modal drawer, no trap
    const heading = document.getElementById(panel.getAttribute('aria-labelledby'));
    expect(heading.textContent).toMatch(/steer: CHK-5/i);
    expect(panel.getAttribute('data-item-id')).toBe('CHK-5');
    expect(panel.getAttribute('data-action')).toBe('re-slice');
    expect(panel.parentElement).toBe(document.body); // portalled (GEO-S014-2-3)
  });

  it('moves focus to the panel heading on open (S14-2-A11Y-2)', async () => {
    render(<SteerPanel {...baseProps()} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('steer-panel-heading')));
  });

  it('returns focus to the element that was focused when it opened (unmount)', async () => {
    const opener = document.createElement('button');
    opener.setAttribute('data-testid', 'opener');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<SteerPanel {...baseProps()} />);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('steer-panel-heading')));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('SteerPanel — context block (S14-2-FIG-1/2, A11Y-7)', () => {
  it('shows the id WITH the human job sentence and the HUMAN action label, never the enum', () => {
    render(<SteerPanel {...baseProps()} />);
    const block = screen.getByTestId('steer-context');
    expect(screen.getByTestId('steer-ctx-id').textContent)
      .toBe('CHK-5 — Compose a structured preview-first prompt');
    const action = screen.getByTestId('steer-ctx-action').textContent;
    expect(action).toBe('Request re-slice / split');
    expect(action).not.toBe('re-slice'); // visible text is never the bare data-action enum
    expect(block.getAttribute('data-source')).toBe('work/demo/items/items.csv#id=CHK-5');
  });

  it('every context value has a programmatically associated visible label (dt/dd pairs)', () => {
    render(<SteerPanel {...baseProps()} />);
    const expected = {
      'steer-ctx-id': 'Item',
      'steer-ctx-job': 'Job',
      'steer-ctx-state': 'State',
      'steer-ctx-value': 'Value',
      'steer-ctx-cost': 'Cost',
      'steer-ctx-action': 'Steering action',
    };
    for (const [testid, label] of Object.entries(expected)) {
      const dd = screen.getByTestId(testid);
      expect(dd.tagName).toBe('DD');
      const dt = dd.previousElementSibling;
      expect(dt.tagName).toBe('DT');
      expect(dt.textContent).toBe(label);
    }
  });

  it('renders human values, no raw CSV keys anywhere in the panel (S14-2-FIG-2)', () => {
    render(<SteerPanel {...baseProps()} />);
    const text = screen.getByTestId('steer-panel').textContent;
    expect(screen.getByTestId('steer-ctx-state').textContent).toBe('planned');
    expect(screen.getByTestId('steer-ctx-value').textContent).toBe('HIGH');
    expect(screen.getByTestId('steer-ctx-cost').textContent).toBe('M');
    for (const raw of ['vc_ratio', 'done_ts', 'started_ts', 'created_ts', 'dora_ref']) {
      expect(text).not.toContain(raw);
    }
  });

  it('FIG-3: an absent source value renders "—", never blank/0/null/undefined', () => {
    render(<SteerPanel {...baseProps({ context: { ...CTX, value: '', cost: undefined } })} />);
    expect(screen.getByTestId('steer-ctx-value').textContent).toBe('—');
    expect(screen.getByTestId('steer-ctx-cost').textContent).toBe('—');
    const text = screen.getByTestId('steer-context').textContent;
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
  });
});

describe('SteerPanel — loading / not-found / error states (FIG-4 fail-soft)', () => {
  it('loading: labelled skeleton, textarea present but DISABLED, Generate guarded', () => {
    render(<SteerPanel {...baseProps({ status: 'loading', context: null })} />);
    expect(screen.getByTestId('steer-panel').textContent).toContain('Loading item context…');
    const ta = screen.getByTestId('intent-note');
    expect(ta.disabled).toBe(true);
    expect(screen.getByTestId('steer-generate').getAttribute('aria-disabled')).toBe('true');
  });

  it('not-found: labelled "Item <id> not found"; textarea + Generate hidden; Cancel/× stay', () => {
    render(<SteerPanel {...baseProps({ itemId: 'D-1', status: 'not-found', context: null })} />);
    expect(screen.getByTestId('steer-panel').textContent).toContain('Item D-1 not found');
    expect(screen.queryByTestId('intent-note')).toBeNull();
    expect(screen.queryByTestId('steer-generate')).toBeNull();
    expect(screen.getByTestId('steer-cancel')).toBeTruthy();
    expect(screen.getByTestId('steer-panel-close')).toBeTruthy();
  });

  it('error: labelled fail-soft message; Cancel/× available', () => {
    render(<SteerPanel {...baseProps({ status: 'error', context: null })} />);
    expect(screen.getByTestId('steer-panel').textContent)
      .toContain('Could not load item context — try again');
    expect(screen.queryByTestId('steer-generate')).toBeNull();
    expect(screen.getByTestId('steer-cancel')).toBeTruthy();
  });
});

describe('SteerPanel — intent note + Generate guard (F-3/F-4)', () => {
  it('textarea has an associated <label> and the designed placeholder (A11Y-5)', () => {
    render(<SteerPanel {...baseProps()} />);
    const ta = screen.getByRole('textbox', { name: /intent/i });
    expect(ta.getAttribute('data-testid')).toBe('intent-note');
    expect(ta.getAttribute('placeholder')).toMatch(/describe what you want to happen/i);
  });

  it('Generate is aria-disabled while empty and does NOT fire onGenerate', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    const gen = screen.getByTestId('steer-generate');
    expect(gen.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(gen);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it('typing ≥1 char enables Generate; activation hands the verbatim note + context onward (UC-S014-3 seam)', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    const ta = screen.getByTestId('intent-note');
    fireEvent.input(ta, { target: { value: 'split this UC into two' } });
    const gen = screen.getByTestId('steer-generate');
    expect(gen.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(gen);
    expect(props.onGenerate).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).toHaveBeenCalledWith('split this UC into two', {
      itemId: 'CHK-5',
      actionType: 're-slice',
      context: CTX,
    });
    // generating must not close the panel (UC-S014-3 renders output INTO it)
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('clearing the note back to empty re-guards Generate', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    const ta = screen.getByTestId('intent-note');
    fireEvent.input(ta, { target: { value: 'x' } });
    expect(screen.getByTestId('steer-generate').getAttribute('aria-disabled')).toBe('false');
    fireEvent.input(ta, { target: { value: '' } });
    expect(screen.getByTestId('steer-generate').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('SteerPanel — close paths (F-5)', () => {
  it('× closes without generating', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /close steer panel/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it('Cancel closes without generating', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onGenerate).not.toHaveBeenCalled();
  });

  it('Esc inside the panel closes (even from the textarea)', () => {
    const props = baseProps();
    render(<SteerPanel {...props} />);
    fireEvent.keyDown(screen.getByTestId('intent-note'), { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
