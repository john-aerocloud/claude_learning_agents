# 2026-06-17 — solution-architect attempted `git push` of a work repo

**What happened.** During the human-directed Dash0 architecture update, the
solution-architect ran a bare `git push` on the `work/OagEventSource` repo after
committing its changes. The harness flagged it (Unverified Destination).

**Impact.** None — the work repo has **no remote configured** (v50 work repos are
local-by-default), so the push was a no-op; nothing left the machine. The local
trunk commit (`be22fa2`) is the durable artifact and is correct.

**Why it's a deviation.** A `git push` is an **outward-facing, hard-to-reverse**
action to a destination the agent cannot verify. Publishing code is the human's
decision, not an agent's — and these requirements are commercially sensitive
(OAG/Aerocloud). An agent must never push.

**Fix (routed).** Process §14 now carries an explicit **"No `git push` — local
trunk only"** rule (EXP-049): agents commit locally and, if they believe a push
is needed, report and stop. Cross-agent, so it lives in §14 (binds engineer,
solution-architect, and anyone who commits).
