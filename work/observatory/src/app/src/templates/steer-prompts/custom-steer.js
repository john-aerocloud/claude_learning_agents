// UC-S014-3 — steer-prompt template: "Custom steer".
// Freeform block: item context as header, operator intent as body. No slash
// command — the operator is steering Claude directly; preview-before-write
// stays the closing instruction. Product-supplied wording (use-cases.md
// §Prompt templates).
export default `Steer request — {{project_id}}

Item: {{item_id}} — {{item_job}}
State: {{item_state}} / Value: {{item_value}} / Cost: {{item_cost}}

Operator intent:
{{intent_note}}

Please preview the proposed change and confirm before writing anything.`;
