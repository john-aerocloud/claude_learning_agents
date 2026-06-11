// Playwright globalSetup — prepare the LIVE-MUTATION fixture copy (UC-S014-4).
//
// WHY A SECOND FIXTURE: specs that MUTATE watched fixture files (the SSE
// live-refresh drives) contaminate parallel workers on the shared server —
// since UC-S014-4, an items.csv change frame makes every OPEN steer panel
// re-fetch /items, so a parallel mutation breaks the "Generate fires ZERO
// requests" pins (steer-prompt AC-4, steer-copy F-1) non-deterministically.
// Isolation, not retries: live-mutation specs run against their OWN dev
// server (webServer #2 in playwright.config.js) watching THIS throwaway copy,
// so the shared fixture is never written mid-run.
//
// The copy is recreated fresh on every run (self-cleaning — a previous run's
// interrupted mutation can never leak in); it is gitignored.
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, 'fixtures', 'repo');
const DEST = resolve(HERE, 'fixtures', 'repo-live-tmp');

export default function globalSetup() {
  rmSync(DEST, { recursive: true, force: true });
  cpSync(SRC, DEST, { recursive: true });
}
