// Repo-root resolver.
// The server runs from the project root per repo conventions, but resolve
// robustly from this file's own location too (capabilities.md: "default
// ../../.." from src/server/, resolving to the project root on a standard
// checkout). Precedence: explicit OBSERVATORY_REPO_ROOT env > computed default.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// src/server/ -> work/observatory -> work -> <repo root>
const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..', '..', '..', '..');

export function resolveRepoRoot() {
  const fromEnv = process.env.OBSERVATORY_REPO_ROOT;
  return fromEnv && fromEnv.trim() !== '' ? resolve(fromEnv) : DEFAULT_ROOT;
}
