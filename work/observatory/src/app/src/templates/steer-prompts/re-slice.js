// UC-S014-3 — steer-prompt template: "Request re-slice / split".
// Follows the /slice-next replenishment shape (.claude/commands/slice-next.md
// — product's JIT decomposition routine). Product-supplied wording
// (use-cases.md §Prompt templates).
//
// UC-S015-4 (additive, backward-compatible): the ENRICHED form below carries
// the operator's proposed Part A / Part B split from the ReslicePreviewPanel
// ({{part_a_job}}/{{part_b_job}} tokens). The plain default export is byte-
// identical to s014 — promptBuilder picks the enriched form ONLY when a part
// is supplied, so every existing 3-arg call site renders exactly as before.
export default `/slice-next (re-slice / split request)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Re-slice intent (operator):
{{intent_note}}

Please propose the thinnest split that delivers a real user outcome and show
me the before/after with explicit NOT-in-scope before writing.`;

// UC-S015-4 — the enriched re-slice/split request (product-supplied wording,
// s015 use-cases.md §UC-S015-4): the BEFORE item + the proposed Part A/Part B
// jobs + the operator intent, instructing Claude to PREVIEW the split (both
// parts' value/cost + queue impact) before writing anything.
export const RESLICE_SPLIT_TEMPLATE = `/slice-next (re-slice / split request)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Proposed split:
  Part A: {{part_a_job}}
  Part B: {{part_b_job}}

Re-slice intent (operator):
{{intent_note}}

Please show the before/after with explicit NOT-in-scope for each part and
confirm both parts pass Killick's test before writing.`;
