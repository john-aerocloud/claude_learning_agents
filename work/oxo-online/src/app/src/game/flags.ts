/**
 * §40 SPA feature-flag seam.
 *
 * s009 lands three user-visible use cases behind flags so the SPA can deploy via
 * the app pipeline BEFORE the backend that serves them is live:
 *   - uc1NameEnabled       — the "Your name" field on the idle view (UC1)
 *   - uc3LeaderboardEnabled — the shared leaderboard panel on the idle view (UC3)
 *   - uc4TwoCopyEnabled    — the split copy-code / copy-link controls (UC4)
 *
 * Flags are read from `window.OXO_CONFIG` — the SAME runtime-config object the
 * deploy pipeline injects the WSS url into (config.js loaded before the bundle,
 * DEFECT-005-001-R2). They DEFAULT OFF: only a strictly-`true` value enables a
 * surface, so a missing config, a missing key, or any non-boolean value keeps
 * the surface OFF and prod unchanged. The orchestrator flips them (config-side)
 * once the backend is deployed; each flag is then FACTORED OUT (code then
 * config) as that UC's done condition — an orphan flag at retro is a principle
 * failure (§40).
 */

export type SpaFlag = 'uc1NameEnabled' | 'uc3LeaderboardEnabled' | 'uc4TwoCopyEnabled';

export function isFlagEnabled(flag: SpaFlag): boolean {
  const config = window.OXO_CONFIG as Record<string, unknown> | undefined;
  return config?.[flag] === true;
}
