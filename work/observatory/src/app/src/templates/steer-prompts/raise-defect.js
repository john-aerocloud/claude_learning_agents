// UC-S014-3 — steer-prompt template: "Raise defect".
// Shape matches the REAL /defect command (.claude/commands/defect.md): its
// four required fields are expected / actual / intent / importance. The
// operator's intent note seeds the description; the orchestrator confirms the
// four fields before writing — the UI never writes anything itself.
// Product-supplied wording (use-cases.md §Prompt templates), field list
// corrected to the committed command shape.
export default `/defect

Project: {{project_id}}
Item: {{item_id}} — {{item_job}}
Current state: {{item_state}}

Defect description (operator intent):
{{intent_note}}

Please treat this as a defect intake: structure the four /defect fields
(expected, actual, intent, importance) from the description above and confirm
them with me before writing any record.`;
