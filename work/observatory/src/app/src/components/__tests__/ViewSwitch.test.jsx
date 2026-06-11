// @covers SPA_VIEWSWITCH
// @covers uc-s015-1
// UC-S015-1 — ViewSwitch: the two-view tablist ("Pipeline" | "In-flight WIP")
// in the main-column header. S15-1-A11Y-1 (keyboard tablist), A11Y-5 (names).
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
    // wraps
    fireEvent.keyDown(pipeline, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(wip);
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
