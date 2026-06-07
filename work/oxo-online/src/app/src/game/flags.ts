/**
 * Use-case feature flags (§40). Slice-scoped, runtime-config backed.
 *
 * The flag mechanism is `window.OXO_CONFIG.<flag>` (the same runtime-config
 * artifact the deploy pipeline writes for `wsUrl`). Runtime config (not a
 * build-time define) so the pipeline can flip a flag ON in a deployed
 * environment WITHOUT a rebuild — UC4 is flipped ON only AFTER UC3 deploys
 * (§19 hard edge #4: the server cannot route `action:'move'` before then).
 *
 * Flags default OFF. Engineer tests for the in-flight UC run flag-ON. A flag is
 * factored out of code then configuration as its UC's done condition — an orphan
 * flag at retro is a §40 principle failure.
 */

/**
 * UC4 (s006 — server-authoritative move relay on the SPA). When OFF the online
 * board stays inert (the s005 behaviour); when ON the board sends `move` on
 * click and renders strictly from server broadcasts.
 */
export function uc4Enabled(): boolean {
  return window.OXO_CONFIG?.uc4Enabled === true;
}
