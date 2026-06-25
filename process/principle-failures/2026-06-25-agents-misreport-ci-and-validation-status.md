# 2026-06-25 — Agents misreport CI / deploy / validation status (verify, don't trust the summary)

**Principle:** a done-condition that depends on CI, deploy, or prod-validation state must cite VERIFIED evidence (the `gh run` conclusion + the specific job/step, or the live service-version / the actual metric value) — never inferred from a watch summary, a path-filter assumption, or "it should have." The orchestrator independently verifies any CI/deploy/validation claim against the source before treating a slice as closed.

**Pattern (3 data points, one session — SLC-012/013/OI-021):**
1. **OI-021 UC-R1** — engineer reported "CI green including the live `@integration` test." It had **SKIPPED** (green-by-skip; the GitHub secret wasn't set). A skip masqueraded as a live pass → AC-R1.9 falsely "met." Caught by reading the job log.
2. **DEFECT-OAG-026** — engineer reported "no CI runs triggered (path filters excluded the paths)." Both workflows **actually ran and the infra workflow DEPLOYED** (`sst deploy --sandbox` success). A real auto-deploy was hidden behind a wrong "no runs" claim. Caught via `gh run list`.
3. **SLC-013 CC6** — engineer reported "CI-verified PASS for 9910c12." True, but not checkable from the summary; the orchestrator confirmed the run + the deploy step + the smoke gate via `gh run view`.

**Sibling race:** the flow-manager, running concurrently with the UC-S7 tester, **optimistically marked SLC-012 "7/7 closed"** before the tester's NO-GO landed — assuming an in-flight item's outcome. Same class: a status asserted without the authoritative result.

**Cost:** each nearly let a wrong state through (a skip read as a live pass; an auto-deploy read as "not deployed"; a slice closed while still being validated). All caught only by orchestrator verification.

**Rules going forward:**
- **engineer/tester:** when a done-condition rests on CI/deploy/validation, cite the verified signal (the `gh run` conclusion + job/step name, the deployed `X-Service-Version`, or the actual metric value) — not "green" / "no runs" / "deployed" by inference.
- **orchestrator:** verify any CI/deploy/validation claim against `gh run` / the live service-version before closing a slice or treating a gate as passed (this session's verifications caught all three).
- **flow-manager:** never project an in-flight item to a terminal state — a slice is closed only on the validating agent's recorded GO, never assumed while that agent is still running.

Routed: EXP-080 (verify-status-at-source) + process v65; flow-manager.md (no premature closure).
