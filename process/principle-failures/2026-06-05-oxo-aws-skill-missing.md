# Principle deviation — `aws-architecture` skill referenced but absent (RESOLVED)

**Resolved 2026-06-05:** Skill created at `.claude/skills/aws-architecture/SKILL.md`.
Solution-architect and cicd agents updated to load it. Reversal conditions from
the oxo-online architecture carried into the skill's §11 reversal log.

---

- **Date:** 2026-06-05
- **Agent:** solution-architect
- **Project:** oxo-online
- **Principle:** "Use the `aws-architecture` skill before producing any AWS
  design, diagram, IAM policy or IaC."

## Deviation
The task and the process-framework doc-map both reference an `aws-architecture`
skill, but it does not exist under `.claude/skills/` (only `delivery-principles`,
`process-framework`, `dora-ledger` are present). I produced the AWS design
without it.

## Mitigation
Applied AWS Well-Architected from first principles across all five pillars;
recorded explicit reversal conditions for every major decision (compute,
realtime transport, database, network). The design is conservative and managed-
service-first, which is what the skill would steer toward.

## Reversal / fix condition (generalised)
When a referenced skill is missing, the orchestrator should either (a) author the
skill via skill-creator before dispatching the dependent agent, or (b) record in
the dispatch that the skill is unavailable so the specialist is not blamed for
its absence. Add `aws-architecture` to the skills set before the next
cloud/hosted project, or remove the reference from the doc-map.
