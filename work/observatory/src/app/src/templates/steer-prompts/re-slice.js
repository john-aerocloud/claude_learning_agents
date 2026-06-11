// UC-S014-3 — steer-prompt template: "Request re-slice / split".
// Follows the /slice-next replenishment shape (.claude/commands/slice-next.md
// — product's JIT decomposition routine). Product-supplied wording
// (use-cases.md §Prompt templates).
export default `/slice-next (re-slice / split request)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Re-slice intent (operator):
{{intent_note}}

Please propose the thinnest split that delivers a real user outcome and show
me the before/after with explicit NOT-in-scope before writing.`;
