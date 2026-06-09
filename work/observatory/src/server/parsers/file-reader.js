// File-reader (UC3 domain).
// Raw string pass-through over a single absolute file path. Pure read; imports
// no transport, no SDK — just node:fs. The server returns markdown / .mmd
// byte-for-byte; it does NOT parse, transform, or render the content (§4.2:
// markdown/.mmd rendering is a SPA concern, not this layer).
//
// Fails soft (§8 resilience): a missing file, a missing parent directory, or a
// path that is a directory all return null rather than throwing — the HTTP
// adapter maps null to { content: null } with HTTP 200, never a 500.

import { readFileSync } from 'node:fs';

/**
 * Read an absolute file path as UTF-8 text.
 * @param {string} absPath absolute path to the file
 * @returns {string | null} raw file contents, or null when absent/unreadable.
 */
export function readRaw(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    // ENOENT (missing file/dir), EISDIR (path is a directory), and any other
    // read error → soft null. The caller never sees an exception.
    return null;
  }
}
