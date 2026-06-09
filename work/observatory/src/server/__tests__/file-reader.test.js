// @covers UC3 — file-reader: raw string pass-through with soft missing-file.
// Acceptance: F4, F5; AC3.1-AC3.6 substrate (raw read; missing → null).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRaw } from '../parsers/file-reader.js';

describe('readRaw — raw file pass-through (UC3 domain)', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'obs-filereader-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns the exact byte-for-byte file contents when present', () => {
    const text = '# DORA baseline\n\n- lead time: 1d\nflow → constraint: engineer\n';
    writeFileSync(join(root, 'baseline.md'), text);
    expect(readRaw(join(root, 'baseline.md'))).toBe(text);
  });

  it('does NOT alter, parse, or transform markdown/mmd content', () => {
    const mmd = 'graph TD\n  UC1-->UC6\n  UC3:::s001changed\n';
    writeFileSync(join(root, 'class-deps.mmd'), mmd);
    expect(readRaw(join(root, 'class-deps.mmd'))).toBe(mmd);
  });

  it('returns null for a missing file — no throw (soft path)', () => {
    expect(readRaw(join(root, 'does-not-exist.md'))).toBeNull();
  });

  it('returns null when the parent directory does not exist — no throw', () => {
    expect(readRaw(join(root, 'no', 'such', 'dir', 'x.md'))).toBeNull();
  });

  it('returns null (not contents) when the path is a directory — no throw', () => {
    mkdirSync(join(root, 'adir'));
    expect(readRaw(join(root, 'adir'))).toBeNull();
  });
});
