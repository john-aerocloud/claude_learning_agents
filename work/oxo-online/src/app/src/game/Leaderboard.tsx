import type { LeaderboardEntry } from './leaderboard-client';

/**
 * spa-leaderboard — the shared standings panel (UC3, idle view, below the board).
 *
 * A real <table> (A11Y-7) with <th scope="col"> headers Rank/Name/W/D/L and a
 * <tbody> of rows, each row a Rank <td> + Name <th scope="row"> + W/D/L <td>s.
 * Four states: loading (role=status live region), error (role=alert), empty
 * (prompt, table still present), populated.
 *
 * STORED-XSS DISPLAY PIN (T-LB-8, A11Y-11): every name renders as React text
 * interpolation `{entry.name}` — never as parsed HTML (no raw-HTML sink). A
 * name containing markup is shown literally; React's default escaping is the
 * primary display control (the write-side charset bound is defence-in-depth).
 * The src/game/ no-raw-HTML-sink code-policy pin (policy.test.tsx) enforces this.
 *
 * Heading is an <h2> (A11Y-12 — the page <h1> is the existing title).
 */
interface LeaderboardProps {
  status: 'loading' | 'error' | 'ready';
  entries: LeaderboardEntry[];
}

const LOADING_TEXT = 'Loading standings…';
const ERROR_TEXT = "Couldn't load the leaderboard.";
const EMPTY_TEXT = 'No scores yet — be the first.';

export function Leaderboard({ status, entries }: LeaderboardProps) {
  return (
    <section className="leaderboard-panel" aria-labelledby="leaderboard-heading">
      <h2 id="leaderboard-heading">Leaderboard</h2>
      {/* Live region: announces load/refresh without stealing focus (A11Y-9). */}
      <p className="leaderboard-status" role="status" aria-live="polite">
        {status === 'loading' ? LOADING_TEXT : ''}
      </p>
      {status === 'error' && (
        <p className="leaderboard-error" role="alert">
          {ERROR_TEXT}
        </p>
      )}
      <table data-testid="leaderboard" aria-label="Leaderboard">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Name</th>
            <th scope="col">W</th>
            <th scope="col">D</th>
            <th scope="col">L</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr
              key={entry.name}
              data-testid="leaderboard-row"
              className={index === 0 ? 'rank-1' : undefined}
            >
              <td className="leaderboard-rank">{index + 1}</td>
              <th scope="row" data-testid="leaderboard-name" className="leaderboard-name">
                {entry.name}
              </th>
              <td data-testid="leaderboard-wins" className="tally">
                {entry.wins}
              </td>
              <td data-testid="leaderboard-draws" className="tally">
                {entry.draws}
              </td>
              <td data-testid="leaderboard-losses" className="tally">
                {entry.losses}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === 'ready' && entries.length === 0 && (
        <p className="leaderboard-empty">{EMPTY_TEXT}</p>
      )}
    </section>
  );
}
