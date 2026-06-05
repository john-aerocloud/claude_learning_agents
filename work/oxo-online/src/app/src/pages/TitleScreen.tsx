/**
 * TitleScreen — slice 001 deployable shell.
 *
 * This is the placeholder title screen. It proves the deployment substrate:
 * the page renders, routing works, and the build artifact is served. There is
 * intentionally NO game logic, no networking, and the buttons are not wired up.
 * Subsequent slices replace the placeholders with real behaviour.
 */
export default function TitleScreen() {
  return (
    <main className="title-screen">
      <h1>oxo-online</h1>
      <p className="tagline">Tic-tac-toe in your browser. No install, no sign-up.</p>

      <section className="play-options" aria-label="Game modes">
        {/* Not wired up in slice 001 — shell only. */}
        <button type="button" disabled>
          Play Online
        </button>
        <button type="button" disabled>
          Play vs Computer
        </button>
      </section>

      <section className="leaderboard" aria-label="Leaderboard">
        <h2>Leaderboard</h2>
        <p className="placeholder">Coming soon.</p>
      </section>
    </main>
  );
}
