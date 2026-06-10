// Repo-root resolver (moved from src/server/repoRoot.js into src/app/server/).
// Resolution: src/app/server/ -> src/app -> src -> work/observatory -> work -> repo root
// That is 5 levels up from this file.
// Precedence: explicit OBSERVATORY_REPO_ROOT env > computed default.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// src/app/server/ -> src/app -> src -> work/observatory -> work -> <repo root>
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..', '..', '..', '..');

export function resolveRepoRoot() {
  const fromEnv = process.env.OBSERVATORY_REPO_ROOT;
  return fromEnv && fromEnv.trim() !== '' ? resolve(fromEnv) : DEFAULT_ROOT;
}
