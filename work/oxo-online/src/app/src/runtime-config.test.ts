import { describe, it, expect } from 'vitest';
// Vite raw import: the source index.html as a string, no node:fs/path needed
// (keeps the app tsconfig free of @types/node).
import indexHtml from '../index.html?raw';

/**
 * DEFECT-005-001-R2 (root cause of the live pairing failures). The deploy
 * pipeline writes the live WSS endpoint to s3://<bucket>/config.js as
 * `window.OXO_CONFIG = {"wsUrl":"wss://…"}`. For the SPA to see it,
 * index.html MUST load /config.js BEFORE the main module bundle — otherwise
 * the bundle reads `window.OXO_CONFIG` while it is still undefined, opens a
 * socket to `undefined`, and every online pairing fails with the generic
 * error. This contract test pins that ordering so the wiring cannot regress.
 */
describe('runtime config wiring — index.html loads /config.js before the bundle', () => {
  const html = indexHtml as unknown as string;

  it('references /config.js with a plain (blocking, non-module) script', () => {
    expect(html).toMatch(/<script\s+src="\/config\.js"\s*>\s*<\/script>/);
  });

  it('loads /config.js BEFORE the main module so window.OXO_CONFIG is defined first', () => {
    const configIdx = html.indexOf('/config.js');
    const mainIdx = html.indexOf('/src/main.tsx');
    expect(configIdx).toBeGreaterThanOrEqual(0);
    expect(mainIdx).toBeGreaterThanOrEqual(0);
    expect(configIdx).toBeLessThan(mainIdx);
  });
});
