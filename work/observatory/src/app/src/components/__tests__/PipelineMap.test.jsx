// @covers PipelineMap
// UC-S002-3 render component test (jsdom). Drives the structure, accessible
// names, and empty-state of the pipeline map BEFORE the UC4/UC5 badge logic.
//
// What this UC pins (acceptance.md): AC3.1 (four names + correct counts),
// AC3.3 (all-zero, no crash), AC3.4 (empty [] → graceful empty state),
// A11Y-1 (region role+name), A11Y-2 (group accessible name carries count).
// NOT covered here (UC4/UC5): state-badge text (A11Y-5), constraint-badge
// (A11Y-6/7) — UC3 only exposes data-status so UC4 can attach the badge.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/preact';
import { PipelineMap } from '../PipelineMap.jsx';

// QueueState[] in flow order (intake → ready → deploy → rework).
const fixture = [
  { name: 'intake', length: 3, min_items: undefined, wip_limit: undefined, status: 'ok' },
  { name: 'ready', length: 1, min_items: 3, wip_limit: undefined, status: 'starving' },
  { name: 'deploy', length: 0, min_items: undefined, wip_limit: undefined, status: 'ok' },
  { name: 'rework', length: 2, min_items: undefined, wip_limit: undefined, status: 'ok' },
];

describe('PipelineMap render (UC-S002-3)', () => {
  it('renders a labelled "Pipeline map" region (A11Y-1)', () => {
    render(<PipelineMap queues={fixture} />);
    expect(screen.getByRole('region', { name: /pipeline map/i })).toBeInTheDocument();
  });

  it('renders all four queue boxes with their names and correct counts (AC3.1)', () => {
    render(<PipelineMap queues={fixture} />);
    const expected = { intake: '3', ready: '1', deploy: '0', rework: '2' };
    for (const [name, count] of Object.entries(expected)) {
      const box = screen.getByTestId(`queue-${name}`);
      expect(box).toBeInTheDocument();
      expect(within(box).getByText(new RegExp(name, 'i'))).toBeInTheDocument();
      expect(within(box).getByTestId('queue-count')).toHaveTextContent(count);
    }
  });

  it('renders each box as role="group" focusable, not clickable (CHK-4 defers drill-down)', () => {
    render(<PipelineMap queues={fixture} />);
    for (const name of ['intake', 'ready', 'deploy', 'rework']) {
      const box = screen.getByTestId(`queue-${name}`);
      expect(box).toHaveAttribute('role', 'group');
      expect(box).toHaveAttribute('tabindex', '0');
      // read-only: no onClick handler turned it into a button/link
      expect(box.tagName).not.toBe('BUTTON');
      expect(box.tagName).not.toBe('A');
    }
  });

  it('carries the queue count (and state when not ok) in the box accessible name (A11Y-2)', () => {
    render(<PipelineMap queues={fixture} />);
    // Ready: length 1, status starving → "Ready queue, 1 item ... starving"
    expect(
      screen.getByRole('group', { name: /ready queue, 1 item.*starving/i }),
    ).toBeInTheDocument();
    // Intake: length 3, status ok → name has count, no state word required
    expect(screen.getByRole('group', { name: /intake queue, 3 item/i })).toBeInTheDocument();
  });

  it('exposes data-status on each box so UC4 can attach the buffer badge', () => {
    render(<PipelineMap queues={fixture} />);
    expect(screen.getByTestId('queue-intake')).toHaveAttribute('data-status', 'ok');
    expect(screen.getByTestId('queue-ready')).toHaveAttribute('data-status', 'starving');
  });

  it('renders buffer meta (floor / cap) when policy thresholds are present', () => {
    render(
      <PipelineMap
        queues={[
          { name: 'intake', length: 5, min_items: undefined, wip_limit: 5, status: 'over-wip' },
          { name: 'ready', length: 1, min_items: 3, wip_limit: undefined, status: 'starving' },
          { name: 'deploy', length: 0, min_items: undefined, wip_limit: undefined, status: 'ok' },
          { name: 'rework', length: 0, min_items: undefined, wip_limit: undefined, status: 'ok' },
        ]}
      />,
    );
    expect(within(screen.getByTestId('queue-ready')).getByText(/floor 3/i)).toBeInTheDocument();
    expect(within(screen.getByTestId('queue-intake')).getByText(/cap 5/i)).toBeInTheDocument();
  });

  it('renders Rework as a return loop region beneath the forward row (GEO-2 structural)', () => {
    render(<PipelineMap queues={fixture} />);
    // structural carrier of the topology: rework lives in a distinct return-loop
    // container, not inline in the forward-row container.
    const forwardRow = screen.getByTestId('forward-row');
    const returnLoop = screen.getByTestId('return-loop');
    expect(within(forwardRow).queryByTestId('queue-rework')).toBeNull();
    expect(within(returnLoop).getByTestId('queue-rework')).toBeInTheDocument();
    // forward row holds the three forward queues
    for (const name of ['intake', 'ready', 'deploy']) {
      expect(within(forwardRow).getByTestId(`queue-${name}`)).toBeInTheDocument();
    }
  });

  it('renders all-zero counts without crashing or blanking (AC3.3)', () => {
    render(
      <PipelineMap
        queues={[
          { name: 'intake', length: 0, status: 'ok' },
          { name: 'ready', length: 0, status: 'ok' },
          { name: 'deploy', length: 0, status: 'ok' },
          { name: 'rework', length: 0, status: 'ok' },
        ]}
      />,
    );
    for (const name of ['intake', 'ready', 'deploy', 'rework']) {
      expect(within(screen.getByTestId(`queue-${name}`)).getByTestId('queue-count')).toHaveTextContent('0');
    }
  });

  it('renders a graceful empty state for an empty QueueState[] (AC3.4)', () => {
    render(<PipelineMap queues={[]} />);
    // region still present; no crash; an explicit empty message
    expect(screen.getByRole('region', { name: /pipeline map/i })).toBeInTheDocument();
    expect(screen.getByText(/no active project/i)).toBeInTheDocument();
    expect(screen.queryByTestId('queue-intake')).toBeNull();
  });

  it('renders decorative flow arrows that are aria-hidden', () => {
    render(<PipelineMap queues={fixture} />);
    const arrows = document.querySelectorAll('[data-testid="flow-arrow"]');
    expect(arrows.length).toBeGreaterThan(0);
    arrows.forEach((a) => expect(a).toHaveAttribute('aria-hidden', 'true'));
  });
});
