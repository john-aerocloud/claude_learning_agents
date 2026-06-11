// UC-S014-3 — promptBuilder: PURE function — steer action type + SteerContext
// + operator intent note → a filled, copy-ready slash-command prompt string.
//
// HEXAGONAL ROLE: domain logic. No DOM, no fetch, no SDK — the templates are
// static strings (templates/steer-prompts/) and this module only substitutes
// tokens. The render layer (SteerPanel) displays the result; the operator —
// not the UI — hands it to Claude. The UI's only write surface remains the
// clipboard (UC-S014-4); this function writes nothing anywhere.
//
// CONTRACT (consumed by SteerPanelContainer on onGenerate):
//   buildPrompt(actionType, context, intentNote) -> string
//   - actionType: SteerMenu enum ('raise-defect'|'re-prioritise'|'re-slice'|
//     'custom') — anything else THROWS (programming error; never a blank or
//     half-filled prompt in front of the operator);
//   - context: the useSteerContext six-field contract (id/job/state/value/
//     cost/sourceRef); project_id is derived from sourceRef
//     ("work/<project>/…") so the prompt names the project humanly;
//   - intentNote: the operator's words, inserted VERBATIM (multiline kept).
//
// FIGURE LEGIBILITY: every token resolves — absent/empty source values render
// "—" (unknown ≠ blank/undefined); the item id always travels WITH its job
// sentence; raw row refs (sourceRef paths, row:N) never appear in the output.
import { STEER_PROMPT_TEMPLATES } from '../templates/steer-prompts/index.js';

/** Unknown ≠ blank: absent/empty values render as an em dash. */
function dash(v) {
  return typeof v === 'string' && v.length > 0 ? v : '—';
}

/** Derive the human project id from the context's sourceRef ("work/<project>/…"). */
function projectFromSourceRef(sourceRef) {
  const m = typeof sourceRef === 'string' ? sourceRef.match(/^work\/([^/]+)\//) : null;
  return m ? m[1] : '—';
}

/**
 * @param {'raise-defect'|'re-prioritise'|'re-slice'|'custom'} actionType
 * @param {{id:string,job:string,state:string,value:string,cost:string,sourceRef:string}|null} context
 * @param {string} intentNote - operator intent, inserted verbatim
 * @returns {string} the filled, copy-ready prompt
 */
export function buildPrompt(actionType, context, intentNote) {
  const template = STEER_PROMPT_TEMPLATES[actionType];
  if (!template) {
    throw new Error(`promptBuilder: unknown steer action type "${actionType}"`);
  }
  const ctx = context || {};
  const tokens = {
    project_id: projectFromSourceRef(ctx.sourceRef),
    item_id: dash(ctx.id),
    item_job: dash(ctx.job),
    item_state: dash(ctx.state),
    item_value: dash(ctx.value),
    item_cost: dash(ctx.cost),
    intent_note: dash(intentNote),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(tokens, name) ? tokens[name] : '—');
}
