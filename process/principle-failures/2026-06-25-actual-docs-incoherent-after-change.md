# 2026-06-25 — actual/ docs left incoherent after a capability shipped (documenter touched one doc, not the set)

**Principle:** the documenter keeps the `actual/` as-built docs MUTUALLY CONSISTENT after every change — it rewrites every RELATED doc, not just the one nearest the change. A shipped capability is reflected everywhere it's relevant (DR, runbook, catalogue, service-design), with no doc still saying "not yet built" or describing a superseded manual procedure. Two `actual/` docs must never disagree about whether a capability exists or how it works.

**What happened:** OI-021 (REST historical seed, `make seed-from-rest`) shipped + was prod-validated; the documenter updated `actual/runbook.md` and the event catalogue — but left `actual/disaster-recovery.md` stale:
- "Historical seed path is **not yet built (OI-021)**" (line 18) — false; it shipped (740 events seeded, validated).
- The "Event store lost" + "Partial data loss" recovery described a **manual REST pull**, not the shipped `make seed-from-rest` operator command.
- Claimed idempotency "via `messageId` fingerprint" — wrong: REST has no `messageId`; the seed uses `oagFingerprint` + field-diff (DEFECT-OAG-004 corrected this for the live feed too).

So the runbook said the seed exists + is validated while the DR doc said it doesn't exist — a direct cross-document contradiction in the canonical as-built record. Found by the human reading the DR doc for the event-store-lost scenario.

**Cost:** the as-built DR runbook would mislead an on-call engineer in the exact scenario the seed was built for (>7-day recovery / table loss) — they'd follow a stale manual procedure or believe the capability doesn't exist.

**Rule going forward (routed to documenter.md "Cross-document coherence"):** after any operational/consumable-surface change, re-read + rewrite EVERY related `actual/` doc; before finishing, run a coherence sweep — grep `actual/` for stale claims ("not yet built", "TODO", "planned", "will", old version/SHA/table names) and for the just-shipped capability's name, reconcile every hit. A stale or self-contradicting `actual/` doc is a principle failure.
