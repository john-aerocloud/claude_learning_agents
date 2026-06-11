// UC-S014-4 — CopyPromptButton: the one-click clipboard handoff. Rendered by
// SteerPanel INSIDE prompt-output-slot, AFTER the <pre> (tab order: prompt →
// copy, S14-4-A11Y-1) and ONLY while a prompt is displayed — absent, never
// disabled, otherwise.
//
// HEXAGONAL ROLE: render layer. navigator.clipboard is a browser DOM concern
// (like SteerPanel's managed focus) — no domain/port change; the clipboard is
// the app's ONLY write surface (NO-WRITE-1).
//
// COPY PAYLOAD CONTRACT (PROMPT-COPY-1 / AC-1): writes the `prompt` prop —
// the SAME string the <pre> renders (byte-equal; no re-serialisation, no
// trimming). A FAILED write shows no success cue: the label only flips and
// `onCopied` only fires after the clipboard promise RESOLVES — the UI never
// claims a copy it didn't make (manual select+copy stays the fallback).
//
// LABEL (S14-4-A11Y-3, stable selector): "Copy prompt" → "Copied ✓" on
// success (the ✓ aria-hidden, so the accessible name is "Copied" — both
// states match /copy/i, getByRole stays stable). Reverts after the
// --dur-toast window so a second click is never misled — and a second click
// RE-COPIES and re-fires onCopied.

import { useState, useRef, useEffect } from 'preact/hooks';
import { toastDurationMs } from './CopyToast.jsx';
import './copy-prompt-btn.css';

/**
 * @param {object} props
 * @param {string} props.prompt - the displayed prompt; the EXACT bytes copied
 * @param {() => void} [props.onCopied] - fires after a SUCCESSFUL clipboard write
 */
export function CopyPromptButton({ prompt, onCopied }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const copy = () => {
    const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
    if (!clip || typeof clip.writeText !== 'function') return; // no API → no false cue
    Promise.resolve()
      .then(() => clip.writeText(prompt))
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setCopied(false); // revert — never a stale "Copied ✓"
        }, toastDurationMs());
        if (typeof onCopied === 'function') onCopied();
      })
      .catch(() => {
        /* write denied/failed → NO success cue; manual select+copy remains */
      });
  };

  return (
    <button
      type="button"
      class="copy-prompt-btn"
      data-testid="copy-prompt-btn"
      data-copied={copied ? 'true' : 'false'}
      onClick={copy}
    >
      {copied ? (
        <>
          {'Copied '}
          <span aria-hidden="true">✓</span>
        </>
      ) : (
        'Copy prompt'
      )}
    </button>
  );
}
