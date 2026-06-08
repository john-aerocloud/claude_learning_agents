import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Leaderboard } from './Leaderboard';
import type { LeaderboardEntry } from './leaderboard-client';

// Vite-native raw import of the component source for the code-policy pin (the
// policy.test.tsx idiom — avoids node:* imports / @types/node).
const leaderboardSource = Object.values(
  import.meta.glob('./Leaderboard.tsx', { query: '?raw', import: 'default', eager: true }),
)[0] as string;

/**
 * @covers spa-leaderboard
 *
 * R3.2 + R3.3 — the Leaderboard table component: loading / empty / error /
 * populated states, real <table> semantics (<th scope=col>), a role=status
 * live region, a role=alert error, the stored-XSS DISPLAY pin (names render as
 * React text — never dangerouslySetInnerHTML), and the EXP-016 geometry
 * assertion (N rows × 5 columns, not a flat line).
 */
const ROWS: LeaderboardEntry[] = [
  { name: 'ACE', wins: 3, draws: 1, losses: 0 },
  { name: 'BEE', wins: 1, draws: 0, losses: 2 },
];

describe('Leaderboard — loading state (AC3.2, A11Y-9)', () => {
  it('shows a role=status live region announcing the load', () => {
    render(<Leaderboard status="loading" entries={[]} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/loading standings/i);
  });
});

describe('Leaderboard — error state (AC3.4, A11Y-9)', () => {
  it('shows a role=alert with the graceful fallback message', () => {
    render(<Leaderboard status="error" entries={[]} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load the leaderboard/i);
  });
});

describe('Leaderboard — empty state (AC3.5)', () => {
  it('renders the empty prompt with the table still present', () => {
    render(<Leaderboard status="ready" entries={[]} />);
    expect(screen.getByText(/no scores yet — be the first/i)).toBeInTheDocument();
    expect(screen.getByTestId('leaderboard')).toBeInTheDocument();
  });
});

describe('Leaderboard — populated table semantics (AC3.2, A11Y-7/12)', () => {
  it('renders a real table resolvable by role+name "Leaderboard"', () => {
    render(<Leaderboard status="ready" entries={ROWS} />);
    expect(screen.getByRole('table', { name: 'Leaderboard' })).toBeInTheDocument();
  });

  it('has <th scope="col"> column headers Rank/Name/W/D/L (A11Y-7)', () => {
    render(<Leaderboard status="ready" entries={ROWS} />);
    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headers).toEqual(['Rank', 'Name', 'W', 'D', 'L']);
    screen.getAllByRole('columnheader').forEach((th) => {
      expect(th).toHaveAttribute('scope', 'col');
    });
  });

  it('renders the panel heading as an <h2> (A11Y-12)', () => {
    render(<Leaderboard status="ready" entries={ROWS} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('renders each entry with name/wins/draws/losses cells (stable testids)', () => {
    render(<Leaderboard status="ready" entries={ROWS} />);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByTestId('leaderboard-name')).toHaveTextContent('ACE');
    expect(first.getByTestId('leaderboard-wins')).toHaveTextContent('3');
    expect(first.getByTestId('leaderboard-draws')).toHaveTextContent('1');
    expect(first.getByTestId('leaderboard-losses')).toHaveTextContent('0');
  });
});

describe('Leaderboard — EXP-016 geometry: rows × columns, not a flat line (R3.3)', () => {
  it('renders N data rows, each exposing exactly the 5 column testids', () => {
    render(<Leaderboard status="ready" entries={ROWS} />);
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows).toHaveLength(ROWS.length);
    rows.forEach((row) => {
      const cell = within(row);
      // A real grid row: name + 3 tallies + a rank cell — 5 columns per row,
      // NOT a single concatenated line.
      expect(cell.getByTestId('leaderboard-name')).toBeInTheDocument();
      expect(cell.getByTestId('leaderboard-wins')).toBeInTheDocument();
      expect(cell.getByTestId('leaderboard-draws')).toBeInTheDocument();
      expect(cell.getByTestId('leaderboard-losses')).toBeInTheDocument();
      // 5 cells in the row (rank th + name th + 3 tally td).
      expect(row.querySelectorAll('th, td')).toHaveLength(5);
    });
  });
});

describe('Leaderboard — stored-XSS display pin (AC3.3, T-LB-8, A11Y-11)', () => {
  it('renders a markup name as LITERAL text (no HTML interpretation)', () => {
    const xss = '<img src=x onerror=alert(1)>';
    render(
      <Leaderboard
        status="ready"
        entries={[{ name: xss, wins: 0, draws: 0, losses: 0 }]}
      />,
    );
    const cell = screen.getByTestId('leaderboard-name');
    // textContent equals the raw string; no <img> element was parsed in.
    expect(cell.textContent).toBe(xss);
    expect(cell.querySelector('img')).toBeNull();
  });

  it('the component uses no raw-HTML sink (code-policy pin)', () => {
    // Pin the USAGE forms (the JSX prop / innerHTML assignment). The repo-wide
    // src/game no-raw-HTML-sink scan in policy.test.tsx is the broader pin.
    expect(leaderboardSource).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(leaderboardSource).not.toMatch(/\.innerHTML\s*=/);
  });
});
