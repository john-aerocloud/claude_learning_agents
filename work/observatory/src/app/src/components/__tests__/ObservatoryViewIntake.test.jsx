// @covers uc-s018-1
// @covers ObservatoryView
// @covers IntakeLauncher
// @covers IntakeWizard
// UC-S018-1 — ObservatoryView composition delta (MINIMAL, per ui-design.md):
// one useState + the IntakeLauncher in a main-column header row + one
// conditional IntakeWizard drawer sibling. The view union / TABS / tabpanels
// are UNCHANGED — pinned here so the S13UC2→S15UC2 hidden-edge seam stays
// untouched.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/preact';
import { ObservatoryView } from '../ObservatoryView.jsx';

const ITEMS = [
  { id: 'REQ-DEMO', type: 'requirement', parent: '', children: 'CHK-1', job: 'r', state: 'active', value: 'HIGH', cost: 'XL' },
  { id: 'CHK-1', type: 'chunk', parent: 'REQ-DEMO', children: '', job: 'c', state: 'done', value: 'HIGH', cost: 'M' },
];

const deps = () => ({
  loadItems: vi.fn().mockResolvedValue(ITEMS),
  loadActiveProject: vi.fn().mockResolvedValue('observatory'),
  loadSlices: vi.fn().mockResolvedValue([]),
  loadArtifact: vi.fn().mockResolvedValue(''),
});

const renderView = async () => {
  render(<ObservatoryView {...deps()} />);
  await waitFor(() => expect(screen.getByTestId('work-item-tree')).toBeTruthy());
};

describe('ObservatoryView intake composition (UC-S018-1)', () => {
  it('AC-S018-1-1: the "New Work" launcher is persistent in the main-column header, OUTSIDE the tablist (own tab stop)', async () => {
    await renderView();
    const launcher = screen.getByRole('button', { name: 'New Work' });
    const tablist = screen.getByTestId('view-switch');
    // beside the tablist in a shared header row, never inside it
    expect(tablist.contains(launcher)).toBe(false);
    const header = document.querySelector('.observatory-main-col__header');
    expect(header).toBeTruthy();
    expect(header.contains(launcher)).toBe(true);
    expect(header.contains(tablist)).toBe(true);
    // inside the main column (persistent on every view)
    expect(document.querySelector('.observatory-main-col').contains(launcher)).toBe(true);
  });

  it('the view union is UNTOUCHED: still exactly the three routed tabs (seam containment)', async () => {
    await renderView();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('data-view'))).toEqual(['pipeline', 'wip', 'defects']);
  });

  it('AC-S018-1-1: no wizard until launched; ONE click opens the IntakeWizard with the three JTBD fields', async () => {
    await renderView();
    expect(screen.queryByTestId('intake-wizard')).toBeNull();
    fireEvent.click(screen.getByTestId('intake-launcher'));
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    expect(screen.getByRole('textbox', { name: /situation/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /motivation/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /outcome/i })).toBeTruthy();
  });

  it('AC-S018-1-3 (structural GEO-S018-1-1): the open wizard is OUTSIDE .observatory-main-col (body-portalled) and the map still renders', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('intake-launcher'));
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    const wizard = screen.getByTestId('intake-wizard');
    expect(document.querySelector('.observatory-main-col').contains(wizard)).toBe(false);
    expect(wizard.parentElement).toBe(document.body);
    // the value-stream map (active pipeline view) is not displaced/unmounted
    expect(screen.getByTestId('value-stream-map')).toBeTruthy();
  });

  it('A11Y-S018-1-4: Esc closes the wizard and focus returns to the launcher', async () => {
    await renderView();
    const launcher = screen.getByTestId('intake-launcher');
    launcher.focus();
    fireEvent.click(launcher);
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    fireEvent.keyDown(screen.getByTestId('intake-wizard'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('intake-wizard')).toBeNull());
    expect(document.activeElement).toBe(launcher);
  });

  it('A11Y-S018-1-4: the × close button closes and returns focus to the launcher', async () => {
    await renderView();
    const launcher = screen.getByTestId('intake-launcher');
    launcher.focus();
    fireEvent.click(launcher);
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    fireEvent.click(screen.getByTestId('intake-wizard-close'));
    await waitFor(() => expect(screen.queryByTestId('intake-wizard')).toBeNull());
    expect(document.activeElement).toBe(launcher);
  });

  it('draft note: closing DISCARDS the draft (no cross-session persistence — re-open is clean)', async () => {
    await renderView();
    fireEvent.click(screen.getByTestId('intake-launcher'));
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    fireEvent.input(screen.getByTestId('jtbd-situation'), { target: { value: 'draft text' } });
    fireEvent.click(screen.getByTestId('intake-wizard-close'));
    await waitFor(() => expect(screen.queryByTestId('intake-wizard')).toBeNull());
    fireEvent.click(screen.getByTestId('intake-launcher'));
    await waitFor(() => expect(screen.getByTestId('intake-wizard')).toBeTruthy());
    expect(screen.getByTestId('jtbd-situation').value).toBe('');
  });
});
