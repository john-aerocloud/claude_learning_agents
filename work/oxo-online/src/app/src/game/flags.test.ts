import { describe, it, expect, afterEach } from 'vitest';
import { isFlagEnabled } from './flags';

/**
 * @covers spa-name-field spa-leaderboard spa-copy-controls
 *
 * §40 feature-flag seam. s009 ships three SPA use cases (UC1 name entry, UC3
 * leaderboard, UC4 two copy controls) behind flags read from
 * `window.OXO_CONFIG` — the SAME runtime-config object the WS url is injected
 * into at deploy time (DEFECT-005-001-R2 wiring). Flags DEFAULT OFF: the SPA
 * deploys via the app pipeline before the backend (name-accepting POST/join,
 * GET /api/leaderboard) is live, so OFF keeps prod unchanged until the
 * orchestrator flips them after the backend lands. Own tests run flag-ON.
 */
describe('isFlagEnabled — OXO_CONFIG flag seam (§40)', () => {
  afterEach(() => {
    delete (window as unknown as { OXO_CONFIG?: unknown }).OXO_CONFIG;
  });

  it('defaults OFF when no OXO_CONFIG is present', () => {
    expect(isFlagEnabled('uc1NameEnabled')).toBe(false);
  });

  it('defaults OFF when the flag key is absent from OXO_CONFIG', () => {
    (window as unknown as { OXO_CONFIG: Record<string, unknown> }).OXO_CONFIG = {
      wsUrl: 'wss://example',
    };
    expect(isFlagEnabled('uc3LeaderboardEnabled')).toBe(false);
  });

  it('is ON only when the flag is strictly true', () => {
    (window as unknown as { OXO_CONFIG: Record<string, unknown> }).OXO_CONFIG = {
      uc4TwoCopyEnabled: true,
    };
    expect(isFlagEnabled('uc4TwoCopyEnabled')).toBe(true);
  });

  it('treats a non-true (truthy) value as OFF (explicit boolean only)', () => {
    (window as unknown as { OXO_CONFIG: Record<string, unknown> }).OXO_CONFIG = {
      uc1NameEnabled: 'true',
    };
    expect(isFlagEnabled('uc1NameEnabled')).toBe(false);
  });
});
