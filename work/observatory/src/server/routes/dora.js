// HTTP adapter for UC3 — DORA / flow / dependency raw pass-through endpoints.
// Adapter depends on the domain reader (file-reader); never the reverse.
// Read-only: registers ONLY GET handlers. Mounted under /api via the createApp
// extension seam (extraRouters) — UC3 does NOT edit app.js or server.js.
//
// §4.2/§4.5: these artifacts are passed through as RAW strings; markdown/.mmd
// rendering is a SPA concern. The server applies NO parsing/transform — it
// returns { content: <raw string> } or { content: null } when absent (fail
// soft, never 500).
//
// SECURITY (AC3.7 / T-READ-12): the artifact name is validated against a fixed
// allowlist before any path is built, and both :id and :artifact are rejected
// if they contain a path separator or a `..` segment, so a request can never
// read outside the intended directory.

import { Router } from 'express';
import { join } from 'node:path';
import { readRaw } from '../parsers/file-reader.js';

// dora artifact name → file under work/<id>/dora/
const DORA_ARTIFACTS = new Set(['flow', 'per-project']);
// deps artifact name → literal file under work/<id>/architecture/dependencies/
const DEPS_ARTIFACTS = new Set(['use-case-deps.mmd', 'class-deps.mmd', 'edge-ledger.md']);

// A repo project id / path segment is a single safe directory name: no
// separators, no parent-dir segments, no NULs. Defends :id against traversal
// even though :artifact is separately allowlisted.
function isSafeSegment(seg) {
  return (
    typeof seg === 'string' &&
    seg.length > 0 &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes('\0') &&
    seg !== '.' &&
    seg !== '..'
  );
}

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createDoraRouter({ repoRoot }) {
  const router = Router();

  // GET /api/dora/baseline → { content: string | null }
  router.get('/dora/baseline', (_req, res) => {
    res.json({ content: readRaw(join(repoRoot, 'process', 'dora', 'baseline.md')) });
  });

  // GET /api/projects/:id/dora/:artifact → { content: string | null }
  // artifact ∈ {flow, per-project}; resolves to work/<id>/dora/<artifact>.md
  router.get('/projects/:id/dora/:artifact', (req, res) => {
    const { id, artifact } = req.params;
    if (!isSafeSegment(id) || !DORA_ARTIFACTS.has(artifact)) {
      return res.status(400).json({ error: 'unknown dora artifact' });
    }
    const path = join(repoRoot, 'work', id, 'dora', `${artifact}.md`);
    return res.json({ content: readRaw(path) });
  });

  // GET /api/projects/:id/deps/:artifact → { content: string | null }
  // artifact ∈ {use-case-deps.mmd, class-deps.mmd, edge-ledger.md}
  router.get('/projects/:id/deps/:artifact', (req, res) => {
    const { id, artifact } = req.params;
    if (!isSafeSegment(id) || !DEPS_ARTIFACTS.has(artifact)) {
      return res.status(400).json({ error: 'unknown deps artifact' });
    }
    const path = join(repoRoot, 'work', id, 'architecture', 'dependencies', artifact);
    return res.json({ content: readRaw(path) });
  });

  return router;
}
