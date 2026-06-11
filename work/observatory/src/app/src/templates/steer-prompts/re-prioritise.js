// UC-S014-3 — steer-prompt template: "Re-prioritise".
// Follows the /intake update shape (.claude/commands/intake.md — the single
// upstream gate where value/cost/queue position are set). Product-supplied
// wording (use-cases.md §Prompt templates).
export default `/intake (priority update)

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current value: {{item_value}} / Cost: {{item_cost}}

Re-prioritisation rationale (operator intent):
{{intent_note}}

Please preview the updated value/cost/vc ratio and queue position before
writing anything.`;
