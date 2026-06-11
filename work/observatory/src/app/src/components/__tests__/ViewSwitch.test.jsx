// @covers SPA_VIEWSWITCH
// @covers uc-s015-1
// @covers uc-s013-2
// UC-S015-1 — ViewSwitch: the two-view tablist ("Pipeline" | "In-flight WIP")
// in the main-column header. S15-1-A11Y-1 (keyboard tablist), A11Y-5 (names).
// UC-S013-2 EXTENDS the same component (reuse, no fork) to a THREE-tab tablist
// (+ "Defects") — see the second describe block (S13-2-A11Y-1/4/5).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { ViewSwitch } from '../ViewSwitch.jsx';

describe('ViewSwitch (UC-S015-1)', () => {
  it('renders a tablist named "Dashboard view" with the two named tabs (S15-1-A11Y-5)', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    expect(screen.getByRole('tablist', { name: 'Dashboard view' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'In-flight WIP' })).toBeInTheDocument();
    expect(screen.getByTestId('view-switch')).toBeInTheDocument();
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('data-view')).toBe('pipeline');
    expect(screen.getByTestId('view-tab-wip').getAttribute('data-view')).toBe('wip');
  });

  it('marks the active tab aria-selected="true" and the other "false" (S15-1-A11Y-1)', () => {
    render(<ViewSwitch active="wip" onSelect={() => {}} />);
    expect(screen.getByTestId('view-tab-wip').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-selected')).toBe('false');
  });

  it('click selects a view (F-1 entry)', () => {
    const onSelect = vi.fn();
    render(<ViewSwitch active="pipeline" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('view-tab-wip'));
    expect(onSelect).toHaveBeenCalledWith('wip');
  });

  it('roving tabindex: only the active tab is in the tab order', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId('view-tab-wip').getAttribute('tabindex')).toBe('-1');
  });

  it('Arrow keys move focus between tabs (S15-1-A11Y-1)', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    const pipeline = screen.getByTestId('view-tab-pipeline');
    const wip = screen.getByTestId('view-tab-wip');
    pipeline.focus();
    fireEvent.keyDown(pipeline, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(wip);
    fireEvent.keyDown(wip, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(pipeline);
    // wraps — to the LAST tab ("Defects" since UC-S013-2 extended the tablist;
    // the full three-tab cycle is pinned in the UC-S013-2 block below)
    fireEvent.keyDown(pipeline, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByTestId('view-tab-defects'));
  });

  it('Enter and Space activate the focused tab (S15-1-A11Y-1)', () => {
    const onSelect = vi.fn();
    render(<ViewSwitch active="pipeline" onSelect={onSelect} />);
    const wip = screen.getByTestId('view-tab-wip');
    wip.focus();
    fireEvent.keyDown(wip, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('wip');
    fireEvent.keyDown(wip, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('each tab references its tabpanel via aria-controls (valid composite structure)', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-controls')).toBe(
      'view-panel-pipeline',
    );
    expect(screen.getByTestId('view-tab-wip').getAttribute('aria-controls')).toBe(
      'view-panel-wip',
    );
  });
});

describe('ViewSwitch third tab "Defects" (UC-S013-2)', () => {
  it('renders THREE named tabs; the Defects tab carries its selector contract (S13-2-A11Y-5)', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    const tab = screen.getByRole('tab', { name: 'Defects' });
    expect(tab).toBe(screen.getByTestId('view-tab-defects'));
    expect(tab.getAttribute('data-view')).toBe('defects');
    expect(tab.getAttribute('aria-controls')).toBe('view-panel-defects');
  });

  it('aria-selected reflects the active view across ALL THREE tabs (S13-2-A11Y-1)', () => {
    render(<ViewSwitch active="defects" onSelect={() => {}} />);
    expect(screen.getByTestId('view-tab-defects').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('view-tab-pipeline').getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('view-tab-wip').getAttribute('aria-selected')).toBe('false');
    // roving tabindex: only the active tab is the tab stop
    expect(screen.getByTestId('view-tab-defects').getAttribute('tabindex')).toBe('0');
    expect(screen.getByTestId('view-tab-wip').getAttribute('tabindex')).toBe('-1');
  });

  it('Arrow keys cycle over all three tabs and wrap; Home/End reach first/last (S13-2-A11Y-1)', () => {
    render(<ViewSwitch active="pipeline" onSelect={() => {}} />);
    const pipeline = screen.getByTestId('view-tab-pipeline');
    const wip = screen.getByTestId('view-tab-wip');
    const defects = screen.getByTestId('view-tab-defects');
    pipeline.focus();
    fireEvent.keyDown(pipeline, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(wip);
    fireEvent.keyDown(wip, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(defects);
    fireEvent.keyDown(defects, { key: 'ArrowRight' }); // wraps
    expect(document.activeElement).toBe(pipeline);
    fireEvent.keyDown(pipeline, { key: 'ArrowLeft' }); // wraps back
    expect(document.activeElement).toBe(defects);
    fireEvent.keyDown(defects, { key: 'Home' });
    expect(document.activeElement).toBe(pipeline);
    fireEvent.keyDown(pipeline, { key: 'End' });
    expect(document.activeElement).toBe(defects);
  });

  it('Enter and Space activate the Defects tab; click selects it (S13-2-A11Y-1)', () => {
    const onSelect = vi.fn();
    render(<ViewSwitch active="pipeline" onSelect={onSelect} />);
    const defects = screen.getByTestId('view-tab-defects');
    defects.focus();
    fireEvent.keyDown(defects, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('defects');
    fireEvent.keyDown(defects, { key: ' ' });
    fireEvent.click(defects);
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onSelect).toHaveBeenLastCalledWith('defects');
  });
});
