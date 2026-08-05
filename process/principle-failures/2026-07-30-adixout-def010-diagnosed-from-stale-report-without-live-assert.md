# 2026-07-30 — AdixOut DEF-010: diagnosed a "defect" from a stale report + a plausible diff, without asserting current live state

**Principle stressed:** assert-real-state (EXP-115) + reproduce-to-confirm (no phantom fixes) — both were applied to *validation* but NOT to *diagnosis*.

## What happened
An external OAG report (relayed by the human) said AdixOut's prod cross-account ingest was "100%
NO_PERMISSIONS." I:
1. Registered DEF-AIDX-010 and marked it **confirmed** on the strength of the report PLUS a
   structural live diff (the prod grant carried an extra `aws:PrincipalAccount` condition that dev,
   which works, lacked) — a plausible root-cause hypothesis.
2. Shipped a prod IAM change (removed the condition) via the gated pipeline, and told the user my
   earlier "prod is delivering" report had been wrong.

Then a second agent's thorough live read — and my own 30-second CloudWatch check — showed the
**opposite**: our prod rule had taken ~2,171 invocations in 45 min with **0 failures UNDER THE OLD
GRANT**, the read model was growing with real airline legs, and OAG's own confirmation put delivery
succeeding since 12:18 UTC (bus go-live). The report was **stale** (it described the pre-go-live
window, matching OAG's DLQ backlog). The `aws:PrincipalAccount` condition was **not** the blocker; my
diagnosis was wrong; the shipped change was harmless but unnecessary; and I had flip-flopped the story
to the user twice.

## Root cause
"Confirm" was satisfied by a trusted report + a self-consistent structural hypothesis, never by a
**live reproduction of the current symptom**. A single current-state metric (delivery/error rate)
would have shown the defect did not reproduce. I over-trusted a relayed external report over my own
live signal — and, one step earlier, "corrected" a CORRECT prior live read ("prod is delivering") to
match the stale report. assert-real-state was being applied to post-fix validation but not to the
diagnosis that authorised a prod change.

## Remedy (v122)
- **`.claude/commands/defect.md`** (the reproduce-to-confirm gate): CONFIRM now REQUIRES a live
  reproduction of the symptom against CURRENT state — a trusted/relayed report + a plausible
  root-cause is NOT confirmation. Assert the current live signal first; if it does not reproduce now,
  record `unconfirmed`/`not_reproduced` (stale report) and STOP. assert-real-state applies to the
  DIAGNOSIS, before the fix.
- Corollary (already true, reinforced): a report — especially external/relayed — is evidence to
  CHECK, not a fact to act on; when it conflicts with your own live read, re-verify, don't just defer
  to the report.

## Note
The delivery outcome was fine (real feed flowing; the harmless grant-simplification aligned prod with
dev). The cost was churn + two wrong statements to the user + an unnecessary (though human-approved)
prod IAM change. The lesson is process, not outcome.
