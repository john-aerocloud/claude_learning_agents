// UC-S005-2 — DOMAIN logic for the work-item tree.
//
// HEXAGONAL ROLE: pure domain. It knows the ubiquitous language of the work-item
// hierarchy (REQ→CHK→SLC→UC, parent/children, /work vs /process) and NOTHING
// about HTTP, fetch, the DOM, or Preact. It turns the flat ItemRecord[] the API
// adapter delivers into a tree the render layer walks. Unit-tested with plain
// records — no jsdom, no network.
//
// THE AC-S005-2-1 INVARIANT: countNodes(buildTree(items)) === items.length. Every
// input row becomes exactly one tree node — an orphan (parent id absent) is
// promoted to a root rather than silently dropped, so the rendered node count
// always matches the items.csv row count (the [REAL-DATA] acceptance gate).
//
// SPACE DERIVATION (requirements §6/§8/§175): the UI contract is `data-space` on
// every node. The source of truth is, in order: an explicit `space` field, then
// the record origin path (`/process/*` → process, else work), else default
// "work" (observatory items are structurally all /work). The distinction is
// rendered regardless so the non-colour-redundant mechanism stays assertable.

/** A tree node wrapping one ItemRecord with render-ready structure. */
function makeNode(item, depth, children) {
  return {
    item,
    depth,
    children,
    hasChildren: children.length > 0,
  };
}

/** Split a pipe-delimited children field ("CHK-1|CHK-4") into ordered ids. */
function childIds(item) {
  const raw = item && typeof item.children === 'string' ? item.children : '';
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

/**
 * Build the REQ→CHK→SLC→UC forest from flat ItemRecord[].
 * Roots = records with no (or absent) parent, PLUS orphans whose parent id is
 * not present in the input (so no node is ever lost). Children are ordered by
 * the parent's `children` pipe-list; any child not named there (but pointing at
 * the parent via `parent`) is appended in input order. Cycles are broken by a
 * visited set (a node renders once).
 * @param {Array|null|undefined} items
 * @returns {Array} forest of nodes
 */
export function buildTree(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const byId = new Map();
  for (const it of items) {
    if (it && it.id != null) byId.set(it.id, it);
  }

  const visited = new Set();

  const build = (item, depth) => {
    if (visited.has(item.id)) return null; // cycle / double-link guard
    visited.add(item.id);

    // Ordered children: first those named in `children`, then any record that
    // points back at this parent but was not listed (resilience).
    const named = childIds(item).filter((cid) => byId.has(cid));
    const namedSet = new Set(named);
    const backRefs = items
      .filter((c) => c && c.parent === item.id && !namedSet.has(c.id))
      .map((c) => c.id);
    const orderedChildIds = [...named, ...backRefs];

    const children = orderedChildIds
      .map((cid) => byId.get(cid))
      .filter(Boolean)
      .map((child) => build(child, depth + 1))
      .filter(Boolean);

    return makeNode(item, depth, children);
  };

  // Root candidates: no parent, or a parent id that is not present in the input.
  const roots = items
    .filter((it) => it && it.id != null)
    .filter((it) => {
      const p = it.parent;
      return !p || p === '' || !byId.has(p);
    })
    .map((it) => build(it, 0))
    .filter(Boolean);

  // Safety net: any record never reached (e.g. in a cycle) becomes a root so the
  // count invariant holds.
  for (const it of items) {
    if (it && it.id != null && !visited.has(it.id)) {
      const n = build(it, 0);
      if (n) roots.push(n);
    }
  }

  return roots;
}

/** Total node count across the forest (the AC-S005-2-1 invariant target). */
export function countNodes(forest) {
  if (!Array.isArray(forest)) return 0;
  return forest.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
}

/**
 * Derive the /work-vs-/process space for a record. Order: explicit `space`
 * field → origin `path` (`/process/*` → process) → default "work".
 * @param {object} item
 * @returns {'work'|'process'}
 */
export function deriveSpace(item) {
  if (!item || typeof item !== 'object') return 'work';
  if (item.space === 'process' || item.space === 'work') return item.space;
  const path = typeof item.path === 'string' ? item.path.replace(/\\/g, '/') : '';
  if (/(^|\/)process\//.test(path)) return 'process';
  return 'work';
}

/**
 * UC-S005-6 — the zoom-out breadcrumb path: the ROOT→selected chain of records
 * for `id`, following each record's `parent` link up to a root. The returned
 * array is ordered root-first with the SELECTED record last (the "current"
 * crumb). Each element is the full ItemRecord so the breadcrumb can label each
 * level (id + type). An orphan (parent id not present in the input) yields just
 * itself; an unknown id or null/empty input yields []. A parent cycle is broken
 * by a visited set so the walk always terminates.
 * @param {string|null|undefined} id
 * @param {Array|null|undefined} items
 * @returns {Array} root→selected chain of ItemRecords (selected last)
 */
export function ancestryPath(id, items) {
  if (!id || !Array.isArray(items) || items.length === 0) return [];
  const byId = new Map();
  for (const it of items) {
    if (it && it.id != null) byId.set(it.id, it);
  }
  if (!byId.has(id)) return [];

  const chain = [];
  const visited = new Set();
  let cur = byId.get(id);
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    chain.push(cur);
    const p = cur.parent;
    cur = p && byId.has(p) ? byId.get(p) : null;
  }
  return chain.reverse(); // root first, selected last
}

/** Flatten the forest into a depth-first ordered list of VISIBLE nodes given an
 * `expanded` Set of item ids. A node is visible if all its ancestors are
 * expanded. Used by the render layer for roving-tabindex keyboard navigation. */
export function visibleNodes(forest, expanded) {
  const out = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      out.push(n);
      if (n.hasChildren && expanded && expanded.has(n.item.id)) {
        walk(n.children);
      }
    }
  };
  walk(Array.isArray(forest) ? forest : []);
  return out;
}
