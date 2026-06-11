// UC-S015-3 — useReslicePreview(): the After-column state of the
// ReslicePreviewPanel. PURE LOCAL state — NO server calls, NO item-context
// loading (that is useSteerContext, composed alongside it in the container).
//
// HEXAGONAL ROLE: domain-side view state. The hook owns the three operator
// inputs of a proposed 2-way split and the two figures derived from them:
//   - canGenerate: the F-S3-4 guard — Part A AND Part B AND intent all
//     non-empty (stricter than the s014 single-field guard: a coherent split
//     proposal needs both parts and a reason).
//   - costNote: the directional cost statement, present ONLY when both parts
//     are non-empty (S15-3-FIG-3: an unfilled split must never look like a
//     staged one — empty parts → null, not a placeholder).
//
// THE UC-S015-4 CONTRACT (ui-design.md state-shape note): on Generate the
// container hands { context, partAJob, partBJob, intentNote } to the enriched
// buildPrompt — partAJob/partBJob map 1:1 onto {{part_a_job}}/{{part_b_job}}.

import { useState } from 'preact/hooks';

/** The directional cost note shown when BOTH parts are non-empty (S15-3-FIG-3). */
export const RESLICE_COST_NOTE =
  'Each part will be smaller than the original — favours flow';

/**
 * @returns {{
 *   partAJob: string, partBJob: string, intentNote: string,
 *   setPartAJob(v:string):void, setPartBJob(v:string):void, setIntentNote(v:string):void,
 *   canGenerate: boolean, costNote: string|null,
 * }}
 */
export function useReslicePreview() {
  const [partAJob, setPartAJob] = useState('');
  const [partBJob, setPartBJob] = useState('');
  const [intentNote, setIntentNote] = useState('');

  const bothParts = partAJob.length > 0 && partBJob.length > 0;

  return {
    partAJob,
    partBJob,
    intentNote,
    setPartAJob,
    setPartBJob,
    setIntentNote,
    canGenerate: bothParts && intentNote.length > 0,
    costNote: bothParts ? RESLICE_COST_NOTE : null,
  };
}
