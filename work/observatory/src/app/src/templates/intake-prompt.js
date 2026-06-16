// UC-S018-4 — the /intake prompt template (the steer-prompts idiom: a static
// string with {{token}}s, no logic, no I/O). lib/intakePromptBuilder.js fills
// the tokens from the wizard's already-lifted JTBD + CoD + rank state at
// Generate time; the operator copies the result and pastes it to Claude so new
// work enters through the SAME human-accept intake gate as steer actions.
//
// The first line is the /intake slash command (.claude/commands/intake.md): the
// composed JOB SENTENCE is the command argument; the structured body below it is
// what Claude reads at the gate. {{rank_block}} is the WHOLE "Queue rank" line
// (with its trailing blank line) — GATED to empty by the builder when there is
// no honest rank, so an incomplete CoD fabricates no rank in the handoff.
export const INTAKE_PROMPT_TEMPLATE = `/intake {{job_sentence}}

Job-to-be-done:
  Situation: {{situation}}
  Motivation: {{motivation}}
  Outcome: {{outcome}}

Value signal: {{value_token}} — {{value_reason}}
Urgency: {{urgency_why}}
Risk of delay: {{risk_of_delay}}
{{rank_block}}(This is an operator-prepared intake. The dashboard wrote nothing — paste this into Claude to enter it through the intake gate.)`;
