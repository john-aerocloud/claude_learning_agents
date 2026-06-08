import { describe, it, expect } from 'vitest';
import { normaliseChatText } from './normalise';

// @covers domain-chat
//
// T-CHAT-4 (AC1.5) — server-side text bound (depth + abuse cap). PURE domain:
//   - trim leading/trailing whitespace;
//   - reject (null) if empty-after-trim;
//   - cap length at 200 chars AFTER trim (engineer's choice: TRUNCATE, pinned);
//   - strip < > & " ' and control characters (defence-in-depth; the primary XSS
//     control is React text render on the client — T-CHAT-3 / delta 011 §2).
// React escaping is THE control; this server bound is depth + an abuse cap.

describe('normaliseChatText — T-CHAT-4 server bound (AC1.5)', () => {
  it('trims leading/trailing whitespace', () => {
    expect(normaliseChatText('  hello  ')).toBe('hello');
  });

  it('rejects an empty string (null)', () => {
    expect(normaliseChatText('')).toBeNull();
  });

  it('rejects a whitespace-only string (null)', () => {
    expect(normaliseChatText('   ')).toBeNull();
    expect(normaliseChatText('\t\n  ')).toBeNull();
  });

  it('rejects a non-string input (null)', () => {
    expect(normaliseChatText(undefined as unknown as string)).toBeNull();
    expect(normaliseChatText(42 as unknown as string)).toBeNull();
    expect(normaliseChatText(null as unknown as string)).toBeNull();
  });

  it('caps length at 200 chars after trim (truncate)', () => {
    const long = 'a'.repeat(250);
    const out = normaliseChatText(long);
    expect(out).toBe('a'.repeat(200));
    expect(out!.length).toBe(200);
  });

  it('caps AFTER trimming (trailing space does not count toward the 200)', () => {
    const out = normaliseChatText('   ' + 'b'.repeat(200) + '   ');
    expect(out).toBe('b'.repeat(200));
    expect(out!.length).toBe(200);
  });

  it('strips < > & " \' from the text (no markup chars survive)', () => {
    const out = normaliseChatText('<img>&"\'x');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('&');
    expect(out).not.toContain('"');
    expect(out).not.toContain("'");
    // The non-markup payload survives.
    expect(out).toContain('img');
    expect(out).toContain('x');
  });

  it('strips control characters (NUL, ESC, vertical tab, DEL) but keeps normal text', () => {
    const out = normaliseChatText('he\x00ll\x1bo\x0bwor\x7fld');
    expect(out).toBe('helloworld');
  });

  it('returns null if the text becomes empty AFTER stripping markup/control chars', () => {
    expect(normaliseChatText('<>&"\'')).toBeNull();
    expect(normaliseChatText('\x00\x1b\x07')).toBeNull();
  });

  it('keeps interior whitespace and ordinary punctuation', () => {
    expect(normaliseChatText('good luck, friend!')).toBe('good luck, friend!');
  });

  it('the XSS injection string renders to a markup-free literal', () => {
    // The opponent-browser render-as-text is the real XSS control (T-CHAT-3);
    // this is the depth bound: the relayed text carries no < > & " '.
    const out = normaliseChatText('<img src=x onerror=alert(1)>');
    expect(out).not.toMatch(/[<>&"']/);
    expect(out).toContain('img src=x onerror=alert(1)');
  });
});
