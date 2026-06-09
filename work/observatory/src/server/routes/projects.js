// HTTP adapter for UC1 — translates the project-registry parser (domain) into
// GET-only Express routes. Adapter depends on domain (parser); never the reverse.
// Read-only: this router registers ONLY GET handlers.

import { Router } from 'express';
import { listProjects, readActive } from '../parsers/project-registry.js';

/**
 * @param {{ repoRoot: string }} deps
 * @returns {import('express').Router}
 */
export function createProjectsRouter({ repoRoot }) {
  const router = Router();

  // GET /api/projects → [{ id, active, status, created, stopped }]
  router.get('/projects', (_req, res) => {
    res.json(listProjects(repoRoot));
  });

  // GET /api/active → { active: string | null }
  router.get('/active', (_req, res) => {
    res.json({ active: readActive(repoRoot) });
  });

  return router;
}
