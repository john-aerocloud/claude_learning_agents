// Project-registry parser (UC1).
// Domain-ish read parser over the repo's `work/` tree. Pure function of a repo
// root path; imports no transport, no SDK — just node:fs/node:path for the
// read-only filesystem read. Fails soft on partial repo state (§8 resilience):
// missing work/, missing project.md, missing/none ACTIVE never throw.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const EXCLUDED_DIRS = new Set(['_TEMPLATE']);

// Directory names under work/ that are not projects even if present as dirs.
// (work/ root files like ACTIVE / README.md are excluded by the dir check.)

/**
 * Parse a minimal YAML-ish frontmatter block (--- ... ---) from a markdown
 * string into a flat key→string map. Only the leading block is read; values are
 * trimmed; empty values become null. This is deliberately tiny — project.md
 * frontmatter is a flat key:value list, not arbitrary YAML.
 */
function parseFrontmatter(text) {
  const out = {};
  if (typeof text !== 'string') return out;
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    // strip inline comments (e.g. `status: active   # active | stopped`)
    let value = line.slice(idx + 1).replace(/\s+#.*$/, '').trim();
    if (!key) continue;
    out[key] = value === '' ? null : value;
  }
  return out;
}

/** Read work/ACTIVE; return the trimmed name, or null for none/empty/missing
 *  or when it names a project that is not present under work/. */
export function readActive(repoRoot) {
  const work = join(repoRoot, 'work');
  let raw;
  try {
    raw = readFileSync(join(work, 'ACTIVE'), 'utf8');
  } catch {
    return null; // absent file → null (AC1.4)
  }
  const name = raw.trim();
  if (name === '' || name.toLowerCase() === 'none') return null; // (AC1.3)
  // names a missing project → treat as none (fail soft)
  try {
    if (!statSync(join(work, name)).isDirectory()) return null;
  } catch {
    return null;
  }
  return name;
}

/** List every directory under work/ except _TEMPLATE, as typed records.
 *  Each record: { id, active, status, created, stopped }.
 *  Fails soft: missing work/ → []; project missing project.md → null meta fields. */
export function listProjects(repoRoot) {
  const work = join(repoRoot, 'work');
  let entries;
  try {
    entries = readdirSync(work, { withFileTypes: true });
  } catch {
    return []; // no work/ dir → empty list, no crash
  }
  const active = readActive(repoRoot);

  return entries
    .filter((e) => e.isDirectory() && !EXCLUDED_DIRS.has(e.name))
    .map((e) => {
      let fm = {};
      try {
        fm = parseFrontmatter(readFileSync(join(work, e.name, 'project.md'), 'utf8'));
      } catch {
        fm = {}; // missing/unreadable project.md → fail soft
      }
      return {
        id: e.name,
        active: e.name === active,
        status: fm.status ?? null,
        created: fm.created ?? null,
        stopped: fm.stopped ?? null,
      };
    });
}
