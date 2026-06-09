// HTTP adapter for UC4 — slice-artifact raw pass-through + slice listing.
// Adapter depends on node:fs (the filesystem is the external system); imports no
// other UC's module so it stays sequentially independent (built in parallel with
// UC2/UC3). Read-only: this router registers ONLY GET handlers.
//
// Endpoints:
//   GET /api/projects/:id/slices                  → string[] of slice slugs
//   GET /api/projects/:id/slices/:slug/:artifact  → { content: string | null }
//
// Resilience (§8): missing slices dir → []; missing artifact / slug / project →
// { content: null } with HTTP 200 (never 500). Artifact name is validated against
// a fixed allowlist (T-READ-13) so :artifact cannot name an arbitrary or
// traversal path — only the seven §4.4 slice artifacts are servable.

import { Router } from 'express';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// §4.4 slice artifacts — the only files this endpoint will serve.
const ARTIFACT_ALLOWLIST = new Set([
  'slice.md',
  'use-cases.md',
  'acceptance.md',
  'route.md',
  'ui-design.md',
  'test-plan.md',
  'result.md',
]);

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createSlicesRouter({ repoRoot }) {
  const router = Router();

  // GET /api/projects/:id/slices → list slice directory slugs (fail soft → []).
  router.get('/projects/:id/slices', (req, res) => {
    const slicesDir = join(repoRoot, 'work', req.params.id, 'slices');
    let entries;
    try {
      entries = readdirSync(slicesDir, { withFileTypes: true });
    } catch {
      return res.json([]); // no slices dir (or no project) → empty list, no crash
    }
    res.json(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  });

  // GET /api/projects/:id/slices/:slug/:artifact → { content: string | null }.
  router.get('/projects/:id/slices/:slug/:artifact', (req, res) => {
    const { id, slug, artifact } = req.params;
    // Allowlist gate: anything not a known §4.4 artifact is a bad request (400).
    // This also defeats traversal — only fixed basenames are ever joined.
    if (!ARTIFACT_ALLOWLIST.has(artifact)) {
      return res.status(400).json({ error: 'unknown artifact' });
    }
    const file = join(repoRoot, 'work', id, 'slices', slug, artifact);
    let content;
    try {
      content = readFileSync(file, 'utf8'); // raw pass-through; no parsing
    } catch {
      return res.json({ content: null }); // absent artifact/slug/project → null, 200
    }
    res.json({ content });
  });

  return router;
}
