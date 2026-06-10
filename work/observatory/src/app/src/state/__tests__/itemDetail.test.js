// @covers itemDetail
// UC-S005-3 — DOMAIN logic for the drill-down detail pane.
//
// itemDetail.js is PURE: it knows how a work-item record maps onto a slice
// directory (the slug) and which raw artifact to show first, and NOTHING about
// fetch/DOM/Preact. These pins fix the slug-derivation rules so the DetailPane
// (render) and the client adapter (HTTP) stay dumb.
import { describe, it, expect } from 'vitest';
import { deriveSliceSlug, defaultArtifactName, paneLabel } from '../itemDetail.js';

describe('deriveSliceSlug (UC-S005-3)', () => {
  const SLUGS = ['s001-read-layer', 's004-value-stream-map', 's005-workitem-tree'];

  it('a SLICE-type node uses its own id as the slug when it matches a slice dir', () => {
    const item = { id: 's001-read-layer', type: 'slice' };
    expect(deriveSliceSlug(item, SLUGS)).toBe('s001-read-layer');
  });

  it('derives the slug from a UC id by its sNNN prefix → matching slice dir', () => {
    // UC-S001-4 → s001 → the slice dir starting "s001-"
    expect(deriveSliceSlug({ id: 'UC-S001-4', type: 'use-case' }, SLUGS)).toBe('s001-read-layer');
    expect(deriveSliceSlug({ id: 'UC-S005-3', type: 'use-case' }, SLUGS)).toBe('s005-workitem-tree');
  });

  it('returns null for a node that maps to no slice (REQ / CHK with no sNNN)', () => {
    expect(deriveSliceSlug({ id: 'REQ-OBSERVATORY', type: 'requirement' }, SLUGS)).toBeNull();
    expect(deriveSliceSlug({ id: 'CHK-4', type: 'chunk' }, SLUGS)).toBeNull();
  });

  it('returns null when the derived sNNN prefix has no matching slice dir', () => {
    expect(deriveSliceSlug({ id: 'UC-S099-1', type: 'use-case' }, SLUGS)).toBeNull();
  });

  it('is fail-soft on null/garbage input', () => {
    expect(deriveSliceSlug(null, SLUGS)).toBeNull();
    expect(deriveSliceSlug({ id: 'UC-S001-1' }, null)).toBeNull();
    expect(deriveSliceSlug({}, SLUGS)).toBeNull();
  });
});

describe('defaultArtifactName (UC-S005-3)', () => {
  it('defaults to slice.md (the human-readable slice narrative)', () => {
    expect(defaultArtifactName()).toBe('slice.md');
  });
});

describe('paneLabel (UC-S005-3)', () => {
  it('builds the accessible region label from the item id (A11Y-S005-3)', () => {
    expect(paneLabel({ id: 'UC-S001-1' })).toBe('Item detail: UC-S001-1');
  });
  it('fails soft to a generic label when no id', () => {
    expect(paneLabel(null)).toBe('Item detail');
  });
});
