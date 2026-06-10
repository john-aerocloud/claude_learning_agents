// @covers UC1 — project registry parser + /api/projects + /api/active
// Acceptance: AC1.1–AC1.5 (use-cases.md), F1, F2, T-READ-1, T-READ-2.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjects, readActive } from '../parsers/project-registry.js';

// --- synthetic fixture tree: a `work/` dir with 2 projects + _TEMPLATE -------
function makeFixtureRoot({ active }) {
  const root = mkdtempSync(join(tmpdir(), 'obs-fixture-'));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  mkdirSync(join(root, 'process'), { recursive: true });

  // oxo-online — full project.md frontmatter
  mkdirSync(join(work, 'oxo-online'));
  writeFileSync(
    join(work, 'oxo-online', 'project.md'),
    '---\nproject: oxo-online\nstatus: stopped\ncreated: 2026-06-05\nstopped: 2026-06-09\n---\n# body\n',
  );

  // observatory — active project, full frontmatter
  mkdirSync(join(work, 'observatory'));
  writeFileSync(
    join(work, 'observatory', 'project.md'),
    '---\nproject: observatory\nstatus: active\ncreated: 2026-06-09\nstopped: \n---\n# body\n',
  );

  // a project with NO project.md (fail-soft path)
  mkdirSync(join(work, 'no-meta'));

  // _TEMPLATE — must be excluded
  mkdirSync(join(work, '_TEMPLATE'));
  writeFileSync(join(work, '_TEMPLATE', 'project.md'), '---\nproject: _TEMPLATE\n---\n');

  // non-project files at work/ root — must be excluded from the list
  writeFileSync(join(work, 'README.md'), 'readme');
  if (active !== undefined) writeFileSync(join(work, 'ACTIVE'), active);

  return root;
}

describe('project registry — synthetic fixture tree', () => {
  let root;
  afterAll(() => root && rmSync(root, { recursive: true, force: true }));

  it('AC1.1 / T-READ-1: lists every work/* dir except _TEMPLATE and non-dir files', () => {
    root = makeFixtureRoot({ active: 'observatory' });
    const ids = listProjects(root).map((p) => p.id).sort();
    expect(ids).toEqual(['no-meta', 'observatory', 'oxo-online']);
    expect(ids).not.toContain('_TEMPLATE');
    expect(ids).not.toContain('README.md');
    expect(ids).not.toContain('ACTIVE');
  });

  it('AC1.2: the project named in work/ACTIVE has active:true; others false', () => {
    const r = makeFixtureRoot({ active: 'observatory' });
    const byId = Object.fromEntries(listProjects(r).map((p) => [p.id, p]));
    expect(byId.observatory.active).toBe(true);
    expect(byId['oxo-online'].active).toBe(false);
    expect(byId['no-meta'].active).toBe(false);
    rmSync(r, { recursive: true, force: true });
  });

  it('reads project.md frontmatter (status/created/stopped) into typed record', () => {
    const r = makeFixtureRoot({ active: 'observatory' });
    const byId = Object.fromEntries(listProjects(r).map((p) => [p.id, p]));
    expect(byId.observatory.status).toBe('active');
    expect(byId.observatory.created).toBe('2026-06-09');
    expect(byId['oxo-online'].status).toBe('stopped');
    expect(byId['oxo-online'].stopped).toBe('2026-06-09');
    rmSync(r, { recursive: true, force: true });
  });

  it('fail-soft: a project missing project.md yields a record, not a crash', () => {
    const r = makeFixtureRoot({ active: 'observatory' });
    const byId = Object.fromEntries(listProjects(r).map((p) => [p.id, p]));
    expect(byId['no-meta']).toBeDefined();
    expect(byId['no-meta'].status).toBeNull();
    expect(byId['no-meta'].created).toBeNull();
    rmSync(r, { recursive: true, force: true });
  });

  it('AC1.3: ACTIVE="none" → readActive null; all projects active:false', () => {
    const r = makeFixtureRoot({ active: 'none' });
    expect(readActive(r)).toBeNull();
    expect(listProjects(r).every((p) => p.active === false)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });

  it('AC1.3 (empty): ACTIVE blank/whitespace → readActive null', () => {
    const r = makeFixtureRoot({ active: '   \n' });
    expect(readActive(r)).toBeNull();
    rmSync(r, { recursive: true, force: true });
  });

  it('AC1.4: ACTIVE file absent → readActive null, no crash', () => {
    const r = makeFixtureRoot({}); // no ACTIVE written
    expect(readActive(r)).toBeNull();
    expect(() => listProjects(r)).not.toThrow();
    rmSync(r, { recursive: true, force: true });
  });

  it('ACTIVE names a project that does not exist → readActive null', () => {
    const r = makeFixtureRoot({ active: 'ghost-project' });
    expect(readActive(r)).toBeNull();
    expect(listProjects(r).every((p) => p.active === false)).toBe(true);
    rmSync(r, { recursive: true, force: true });
  });

  it('readActive returns the active name when it names a present project', () => {
    const r = makeFixtureRoot({ active: 'observatory' });
    expect(readActive(r)).toBe('observatory');
    rmSync(r, { recursive: true, force: true });
  });

  it('fail-soft: a missing work/ dir entirely → empty list, no crash', () => {
    const empty = mkdtempSync(join(tmpdir(), 'obs-empty-'));
    expect(listProjects(empty)).toEqual([]);
    expect(readActive(empty)).toBeNull();
    rmSync(empty, { recursive: true, force: true });
  });
});
