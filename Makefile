# ROOT Makefile — AGENT OPERATIONS (process v17 §36 / v23 §33, IMP-003)
#
# Parameterised, allowlist-shaped entry points for the operations every agent
# repeats. No inline env-var assembly, no hand-built python invocations — a
# target + arguments, automatable and committed.
#
# All targets run from the project root. PROJECT defaults to work/ACTIVE.
#
# DO NOT CONFUSE with work/<project>/src/infra/Makefile — that one is
# DEPLOY-OPS only (bootstrap/deploy-oidc/deploy/diff/destroy). The agent-ops
# targets (validate/smoke/wi-*/test-*) live HERE and only here.
# Agents: per v23 §33.5 you create/extend targets here yourself when your
# role needs one — tested, documented, committed, named in your return.

# make's default SHELL is sh.exe, which is NOT on PATH on this Windows host —
# otherwise the $(shell ...) calls below and every recipe emit "The system cannot
# find the path specified" and limp via a fallback. Set this FIRST, before any
# $(shell): if Git's bundled sh is present, use it globally — it's a real POSIX
# sh and every recipe in this file is sh-compatible. Guarded by wildcard so it's
# a no-op where Git isn't at this path (override GIT_SH to move it). Uses the 8.3
# short path to avoid spaces and the WSL bash that owns `bash` on PATH.
GIT_SH ?= C:/PROGRA~1/Git/usr/bin/sh.exe
ifneq ($(wildcard $(GIT_SH)),)
SHELL := $(GIT_SH)
endif

PROJECT ?= $(shell cat work/ACTIVE 2>/dev/null)
APP     := work/$(PROJECT)/src/app
INFRA   := work/$(PROJECT)/src/infra
WORKITEMS := sh .claude/skills/work-items/scripts/work-items
AWS_PROFILE ?= $(shell cat .claude/config/aws-profile 2>/dev/null)
PY      ?= $(shell sh .claude/skills/dora-ledger/scripts/dora --python)
# The interpreter the WORK-ITEMS launcher resolves (deferred: `?=` keeps the
# $(shell) out of every make parse). Used by test-wi — never bare python3.
WIPY    ?= $(shell sh .claude/skills/work-items/scripts/work-items --python)
SQLCMD       ?= C:/Program Files/Microsoft SQL Server/Client SDK/ODBC/170/Tools/Binn/sqlcmd.exe
REMED_SERVER ?= (localdb)\MSSQLLocalDB
REMED_DB     ?= viggo_remed_test

# --- Project worktree lifecycle (v83+, worktree-per-project) -------------------
# Each project lives in its OWN git worktree on branch instance/<project>; THIS
# (main) tree is the integration branch that process improvements fold back into.
# The .claude/scripts/worktree helper owns the lifecycle, including the safety
# guard that a worktree's nested project repo is PARKED (never deleted) on remove.
# PROJECT has no default here (work/ACTIVE is `none` in the integration tree) —
# always pass PROJECT=<name>.
#   make project-worktree PROJECT=ROC          # ensure worktree+branch exist; print its path
#   make project-worktree-path PROJECT=ROC     # print the worktree path (no create)
#   make project-worktrees                     # list all worktrees
#   make project-foldback PROJECT=ROC          # fold BACK: merge instance/ROC -> main (unattended; at retro close)
#   make project-update PROJECT=ROC            # fold FORWARD: merge main -> instance/ROC (worktree gets latest process)
#   make project-worktree-remove PROJECT=ROC   # park the project repo, then remove the worktree
WORKTREE := sh .claude/scripts/worktree
project-worktree:
	@$(WORKTREE) ensure $(PROJECT)
project-worktree-path:
	@$(WORKTREE) path $(PROJECT)
project-worktrees:
	@$(WORKTREE) list
project-foldback:
	$(WORKTREE) foldback $(PROJECT)
project-update:
	$(WORKTREE) update $(PROJECT)
project-worktree-remove:
	$(WORKTREE) remove $(PROJECT)

# --- DEFECT-OAG-076: the two lanes, and never delete work that exists nowhere else
# `isolation: worktree` on a PROJECT-REPO item destroyed DEFECT-OAG-072 outright
# (`git cat-file -t fb080d9` => `fatal: Not a valid object name`). The parent
# gitignores each project's own nested repo, so a parent-repo worktree NEVER
# CONTAINS work/<project>: the agent finds nothing to edit and no legal way to
# commit, clones the project repo inside its worktree, commits there, and the
# auto-clean takes the objects with it. Two lanes, and a dispatch must know which:
#
#   parent-repo  (.claude/ process/ Makefile CLAUDE.md)  IS in the worktree
#                -> committing in the worktree is correct and safe
#   project-repo (work/<project>/**)                     is NOT in the worktree
#                -> edit at the real shared path; commit via `make commit-isolated`
#                   (.claude/tools/isolated-commit.js — the private index, which had
#                    already landed as DEFECT-OAG-058 three hours before the loss)
#
#   make dispatch-check ID=DEFECT-OAG-076 [PROJECT=P] [ISOLATION=worktree|none]
#        -> exit 2 (loud) if this item may not take worktree isolation. The lane is
#           DECLARED on the item (`lane:`); undeclared/unrecognised fails CLOSED.
#   make worktree-guard DIR=<path> [RESCUE_TO=<dir>]
#        -> exit 2 if removing DIR would destroy commits that exist in no surviving
#           repo (RESCUE_TO first writes a recoverable bundle). DIR=--all sweeps every
#           registered worktree plus .claude/worktrees/*.
# Pure git + filesystem; NO creds, NO network.
dispatch-check:
	node .claude/tools/worktree-guard.js dispatch-check --item $(ID) \
	  $(if $(PROJECT),--project $(PROJECT),) --isolation $(if $(ISOLATION),$(ISOLATION),worktree)

worktree-guard:
	@node .claude/tools/worktree-guard.js \
	  $(if $(filter --all,$(DIR)),scan-all,scan $(if $(DIR),$(DIR),.)) \
	  $(if $(RESCUE_TO),--rescue-to $(RESCUE_TO),)

# GUARDED cleanup of a finished AGENT worktree — refuses rather than destroying.
#   make worktree-reap DIR=<path>|--all
worktree-reap:
	$(WORKTREE) reap $(if $(DIR),$(DIR),--all)

# --- an IN-PROGRESS git operation left ARMED in a shared tree -------------------
# (OI-ABANDONED-SEQUENCER-STATE-ARMS-A-56-COMMIT-DESTRUCTION)
#
# `.git/sequencer` sat in the shared work/OagEventSource tree for SIX HOURS holding
# a two-step revert todo whose saved head was FIFTY-SIX commits behind HEAD — the
# whole output of seven agents in one session — and `git revert --abort` rewinds to
# that saved head. `git status --porcelain` says NOTHING about it, so every
# cleanliness check here (loop-gate, the fold-forward dirty check) passed with it
# armed. THE SAFE VERB IS THE OBSCURE ONE: `--quit` clears the state and leaves HEAD
# and the working tree alone; `--abort` is the one everybody knows.
#
# Detects .git/sequencer, REVERT_HEAD, CHERRY_PICK_HEAD, MERGE_HEAD and
# rebase-merge/rebase-apply across the parent repo, every worktree AND every nested
# project repo (the incident was in a nested one), and reports HOW MANY COMMITS
# `--abort` would discard — "state present" is ignorable, "56 commits" is not.
# READ-ONLY: it never runs a writing git verb. Also wired as loop-gate check 14, so
# it runs before EVERY pull; a gate in no workflow is not a gate.
#   make sequencer-guard [DIR=<path>] [GRACE_MIN=30] [JSON=1]
# Exit 2 iff commits are at stake / residue is abandoned or unmeasurable.
sequencer-guard:
	@node .claude/tools/sequencer-guard.js scan $(if $(DIR),$(DIR),) \
	  $(if $(GRACE_MIN),--grace-min $(GRACE_MIN),) $(if $(JSON),--json,)

# --- a file a committed make target RUNS must be on trunk -----------------------
# (OI-GITIGNORE-SWALLOWS-COMMITTED-TOOLS, AC-GI.3)
#
# A blanket `.gitignore` on `src/app/scripts/*.mjs` swallowed a committed tool SIX
# times in one project. Each time: an engineer writes a re-runnable tool, wires a make
# target to it, `git add`s it, git says NOTHING, the suite is green, and the tool is on
# exactly one machine. That is the DEF-ROC-001 / v89 FALSE GREEN — nothing goes red
# because nothing was looking. The remedy had become "append another negation line", so
# the ignore file's negation list had turned into a written record of the trap firing.
#
# This is the general form and it is deliberately indifferent to WHICH ignore rule,
# directory or project caused the omission (the founding instance, DEF-ROC-001, was a
# different project). Four verdicts per reference:
#   tracked    fine.
#   generated  fine — some committed generator declares it as an output (`--outfile=`
#              in a makefile recipe or a package.json script), so it is reproducible
#              from trunk. THE EXEMPTION IS DERIVED, never a hand-kept list: a
#              hand-kept list is the negation list again, and a `build/`-by-name rule
#              would have EXCUSED the sixth firing rather than caught it.
#   untracked  FINDING — on this machine and nowhere else.
#   dangling   FINDING — on no machine: the target outlived its file. Same false green
#              from the other side (`make sync-linear` sat on trunk for months after
#              its script was retired; this check is what found it).
#
# Not flooding is part of the job (§F8a): only COMMITTED makefiles are scanned, and
# globs, prose inside an `echo`, absolute paths, paths outside the repo and unresolvable
# variables are not findings. There is deliberately NO ratchet baseline — the honest
# count is ZERO, so any finding is a regression and there is no floor to erode.
#
# Wired as `loop-gate` check 9, so it runs before EVERY pull: a gate in no workflow is
# not a gate. Self-tests run under `make test-tools`.
# Pure git + filesystem; NO creds, NO network. Exit 1 = findings, 2 = could not run.
#   make make-refs-tracked [PROJECT=OagEventSource] [JSON=1]
#   make make-refs-tracked REPO=work/OagEventSource
make-refs-tracked:
	@node .claude/tools/make-refs-tracked.js \
	  $(if $(REPO),--repo $(REPO),--project $(PROJECT) --repo-root .) $(if $(JSON),--json,)

# --- IS THE DEPLOY LANE OPEN? (DEF-ROC-131) -------------------------------------
# The READ-ONLY live probe behind `loop-gate` check 16, and the thing that lets you
# answer in one command the question that was invisible to this whole gate for the
# better part of 2026-08-27: can anything we push actually reach an environment?
#
# It reads the DEPLOY JOB'S OWN CONCLUSION and the transitive closure of its
# `needs:` (from the workflow source -- the GitHub jobs API does not carry `needs`),
# NEVER the run's overall conclusion. That distinction is the whole tool: on this
# repo `Dependency audit (prod-runtime, blocking)` is red on EVERY push
# (DEF-ROC-068, no upstream fix) and is deliberately NOT in the deploy job's needs,
# so ALL THREE real captures it is pinned against carry run conclusion `failure`
# and one of them DEPLOYED. A limb reading the run conclusion would be on
# permanently and ignored inside a day.
#
# Four verdicts, never two: open / blocked / in-flight (a deploy still running has
# NOT landed -- the ROC health endpoint served the new buildSha mid-cutover on
# 2026-08-27) / NOT-ESTABLISHED. Read-only: `gh` + `git log` + the workflow file;
# no writes, no secrets. Self-tests: `make test-tools`.
#   make deploy-lane PROJECT=ROC          # human line; exit 2 iff BLOCKED
#   make deploy-lane PROJECT=ROC JSON=1   # the full report
deploy-lane:
	@node .claude/tools/deploy-lane.js --project $(PROJECT) --repo-root . $(if $(JSON),--json,)

# --- orphaned LOCAL CONTAINERS (DEFECT-OAG-091) ---------------------------------
# The container equivalent of worktree-reap, and the tool EXP-133 should have
# shipped with the container-per-engineer. `ddb-local-down` is per-dispatch and must
# be called by the agent that created the container, so any agent that dies, stalls
# or forgets leaks its container FOREVER. On 2026-08-10 that was thirteen orphans
# (ten of them 2 DAYS old), load average 19.85, and a two-file test run at 301
# SECONDS which took 877 MILLISECONDS after reaping — 340x — having first killed
# four agents in a row and produced reds that were green in isolation.
#
# It is SAFE TO RUN AT ANY TIME and is wired into `loop-gate` (check 8) so it runs
# before EVERY pull rather than when someone remembers (§17e). Every predicate fails
# safe toward KEEPING: ownership by compose provenance (never a name list), an age
# floor, a live LEASE (renewed at every gated test-tier entry, so another instance's
# live container is protected), an established-connection veto for the mid-write
# case, and a full TTL of grace for an unleased container. It touches docker objects
# and a machine-local lease dir ONLY — never the working tree.
#
#   make container-reap PROJECT=OagEventSource              # sweep and remove
#   make container-reap PROJECT=OagEventSource DRY_RUN=1    # say what it WOULD do
#   make container-orphans PROJECT=OagEventSource           # read-only report
container-reap:
	@node .claude/tools/container-reap.js reap --project $(PROJECT) \
	  $(if $(DRY_RUN),--dry-run,) $(if $(JSON),--json,)

container-orphans:
	@node .claude/tools/container-reap.js scan --project $(PROJECT) $(if $(JSON),--json,)

# --- Stack claim/release (DEF-ROC-062) ------------------------------------------
# The LEASE WRITER container-reap.js has always expected but no project ever
# supplied. With no claim, a container's ONLY protection from the reaper is age —
# which cannot distinguish "in active use" from "abandoned". This is what let the
# ROC reaper destroy FOUR RUNNING containers mid-validation (DEF-ROC-062): the
# stack was simply older than leaseTtlS. `claim` writes a lease (the SAME file
# container-reap.js already reads as an absolute veto) for every container the
# project currently owns and has running; `release` removes them; a TTL means an
# unrenewed claim from a dead agent simply EXPIRES rather than deadlocking the
# tree. RENEW is just calling `claim` again — wired below into the ROC-specific
# stack lifecycle + gated test targets so it happens on every sign of life, not
# only at start (mirrors OagEventSource's ddb-local-assert-ours precedent).
#   make stack-claim PROJECT=ROC [TTL=3600] [LABEL=my-label] [FORCE=1]
#   make stack-release PROJECT=ROC [LABEL=my-label] [FORCE=1]
#   make stack-status PROJECT=ROC              # who holds the claim + remaining TTL
stack-claim:
	@node .claude/tools/stack-claim.js claim --project $(PROJECT) \
	  $(if $(TTL),--ttl $(TTL),) $(if $(LABEL),--label "$(LABEL)",) \
	  $(if $(FORCE),--force,) $(if $(JSON),--json,)

stack-release:
	@node .claude/tools/stack-claim.js release --project $(PROJECT) \
	  $(if $(LABEL),--label "$(LABEL)",) $(if $(FORCE),--force,) $(if $(JSON),--json,)

stack-status:
	@node .claude/tools/stack-claim.js status --project $(PROJECT) $(if $(JSON),--json,)

# --- AWS SSO login -------------------------------------------------------------
# Re-authenticate the project's SSO profile when the cached token has expired
# (symptom: any aws CLI call fails with "Token has expired and refresh failed").
# Opens the SSO browser flow for the human to approve; agents may invoke it and
# wait. Profile comes from .claude/config/aws-profile (aws-profile skill).
# make sso-login [AWS_PROFILE=dev-int]
sso-login:
	aws sso login --profile $(AWS_PROFILE)

# Convenience SSO logins per OagEventSource environment (v56 — human-directed):
#   local testing -> sandbox, cicd dev -> ids-dev, cicd prod -> ids-prod.
# make sso-login-sandbox | make sso-login-dev | make sso-login-prod
sso-login-sandbox:
	aws sso login --profile sandbox

sso-login-dev:
	aws sso login --profile ids-dev

sso-login-prod:
	aws sso login --profile ids-prod

# --- GitHub CLI SSO auth -------------------------------------------------------
# GitHub (AeroCloudSystems org) uses SAML SSO — gh must authenticate via the
# browser web flow; a bare PAT won't carry the org SSO authorization. Mirrors
# sso-login above. Recipes are deliberately shell-agnostic (the `||` operator
# works in cmd.exe AND sh), so NO SHELL override is needed and they run the same
# under make's default Windows shell — matching every other target in this file.
# First login is interactive; run it yourself:  ! make gh-auth
#   make gh-status  -> show current auth state on github.com
#   make gh-auth    -> SSO browser login (web flow)
#   make gh-ensure  -> guard: if not authed, auto-runs gh-auth (used as a prereq)
#   make gh-ci-edcs -> list recent eDCS server CI runs (auto-auths first)
GH_HOST ?= github.com
GH_ORG  ?= AeroCloudSystems

gh-status:
	gh auth status -h $(GH_HOST)

gh-auth:
	@gh auth status -h $(GH_HOST) >/dev/null 2>&1 \
	  && echo "gh already authenticated on $(GH_HOST)." \
	  || gh auth login -h $(GH_HOST) -p https -w

# Guard: auto-launch SSO login on a real terminal; fail fast with instructions
# when non-interactive (e.g. an agent shell) so it NEVER hangs waiting on a login.
gh-ensure:
	@gh auth status -h $(GH_HOST) >/dev/null 2>&1 || { \
	  if [ -t 1 ]; then echo ">> gh not authenticated — launching SSO login..."; gh auth login -h $(GH_HOST) -p https -w; \
	  else echo ">> gh not authenticated on $(GH_HOST). Run:  ! make gh-auth" >&2; exit 1; fi; }

gh-ci-edcs: gh-ensure
	gh run list --repo $(GH_ORG)/eDCS --workflow build-edcs-server.yml -L 5

# --- eDCS working-tree integrity -----------------------------------------------
# Working-tree directory deletions leave NO git record — a build/clean/checkout
# can silently rm a tracked source folder (happened to eDCSChatWebClient on
# 2026-07-02, caught only by chance). Run the CHECK after any agent build/checkout
# against the eDCS repo; wire it as the last step of build/run targets so a ' D'
# deletion fails the target instead of going unnoticed.
#   make edcs-worktree-check    -> flag tracked files missing from disk; exit 1 if any
#   make edcs-worktree-restore  -> restore ONLY the missing files (keeps other edits)
EDCS ?= work/Viggo-fix/eDCS

edcs-worktree-check:
	@missing=$$(git -C $(EDCS) ls-files --deleted); \
	 if [ -n "$$missing" ]; then \
	   nfiles=$$(printf '%s\n' "$$missing" | grep -c .); \
	   ndirs=$$(printf '%s\n' "$$missing" | sed 's:/.*::' | sort -u | grep -c .); \
	   echo ">> eDCS WORKTREE ALERT: $$nfiles tracked file(s) missing from disk across $$ndirs top-level path(s):"; \
	   printf '%s\n' "$$missing" | sed 's:/.*::' | sort | uniq -c | sort -rn | sed 's/^/   /'; \
	   echo ">> recover with: make edcs-worktree-restore"; \
	   exit 1; \
	 else echo "eDCS worktree OK - no tracked files missing from disk ($(EDCS))"; fi

edcs-worktree-restore:
	@git -C $(EDCS) ls-files --deleted -z | xargs -0 -r git -C $(EDCS) restore --
	@echo "restored missing tracked files; remaining changes:"; git -C $(EDCS) status --short

# MECHANICAL §F8 auto-retro gate (v68). Exits non-zero (code 2) when retro is DUE
# — i.e. a slice closed / a defect resolved / a deploy failed since the last retro
# row. The loop MUST run this before advancing past a slice/chunk/defect boundary;
# a non-zero exit means "fire /retro to drain the debt before pulling next work".
# v69 (EXP-085) cadence: ROUTINE slice/chunk closes batch up to THRESHOLD (default 3)
# before a retro is due; INCIDENT events (defect resolve / deploy failure) are NOT
# batched — a single one forces RETRO DUE immediately so real learning never defers.
# make retro-debt PROJECT=OagEventSource [THRESHOLD=3]
retro-debt:
	$(WORKITEMS) retro-debt --project $(PROJECT) $(if $(THRESHOLD),--threshold $(THRESHOLD),)

# Drain the retro-debt counter: write the last-retro marker (v82). The retro's
# CLOSE step runs this — it replaces the old "record a `retro` ledger row" reset.
# make retro-mark PROJECT=OagEventSource
retro-mark:
	$(WORKITEMS) retro-mark --project $(PROJECT)

# The CHEAP per-close constraint read (v136, EXP-132). Drains INCIDENT retro debt
# ONLY while the constraint is provably unchanged — the machinery decides, not the
# orchestrator. Exit 2 = the constraint SHIFTED (or cannot be read, or routine debt
# hit its threshold) and a FULL /retro is genuinely due. This is not a softening of
# §F8: the expensive path stays mandatory in exactly the case a retro exists for.
# make parts-check PROJECT=<p>
parts-check:
	$(WORKITEMS) parts-check --project $(PROJECT) $(if $(THRESHOLD),--threshold $(THRESHOLD),)

# MECHANICAL loop PRECONDITION gate. Run it BEFORE every pull; exit 2 = do NOT
# pull until the printed violations are cleared (same exit-code discipline as
# retro-debt, which it delegates check 4 to).
#
# WHY: STAGE F documents these preconditions as orchestrator JUDGEMENT and they
# are reliably skipped — measured this cycle, DEFECT-OAG-045 sat in `validating`
# 35.5h and DEFECT-OAG-048 27.3h, both already pushed AND deployed, both merely
# awaiting a tester dispatch nobody made; Ready sat at 1 against a min_items
# floor of 3; Intake sat at 14 against a wip_limit of 10 enforced NOWHERE. The
# one mechanised obligation (retro-debt) fired and WAS obeyed. The mechanised
# gate is obeyed; the documented one is not — so this mechanises the rest.
#
# Reports EVERY violated precondition (not just the first), each as one
# actionable line naming the ids and the remedy:
#   1 stalled-validation  item in validating/dev-validating/prod-validating
#                         dwelling > STALE_HOURS whose latest fixed/built_green/
#                         deployed/promoted event carries a `ref:` (= work done,
#                         only a dispatch missing). Push state is read from GIT
#                         in work/<p>/ (its own repo, v50), NEVER from note prose.
#   2 ready-below-floor   depth(ready) < ready.min_items  (queues/policy.csv)
#   3 queue-over-cap      a queue depth > its wip_limit (queues/policy.csv), at
#                         TWO SEVERITIES (v126 addendum): a WIP-STAGE queue (ready/wip/
#                         rework) BLOCKS; a BACKLOG queue (intake) is ADVISORY
#                         and does NOT affect the exit code. Little's Law governs
#                         WIP, not backlog depth — blocking the pull for a deep
#                         backlog inverts the constraint (the remedy IS the pull)
#                         and pressures agents to close real findings. Declared
#                         per queue as a `kind` row in queues/policy.csv.
#   4 retro-debt          delegated to the retro-debt computation
#  11 stalled-work        AN ITEM CLAIMED OR SCHEDULED WITH NO RECORDED ACTIVITY
#                         (DEFECT-OAG-127). Check 1 sees VALIDATION states only and
#                         only blocks when the work is provably finished, so work
#                         abandoned in `fixing`/`building`/`reproducing`/`deploying`/
#                         `reworking` — and an item SCHEDULED into `ready` that
#                         nobody pulled — was invisible to EVERY limb. Measured on
#                         the real 2026-08-19 tree: 11 of 12 occupied slots
#                         invisible, six idle 4.92-7.31d and three scheduled
#                         5.12-8.11d, while `wip 9` read exactly as nine agents
#                         working. Population DERIVED from state-graphs.json
#                         (non-terminal + non-backlog queue + not owner=external),
#                         so a state added later is covered by construction.
#                         Thresholds anchored on MEASURED MEDIAN dwell (24h for the
#                         agent-owned states = 58-3300x their medians; 48h for
#                         ready/scheduled, a different quantity), tunable per queue
#                         with a `stall_hours` row in queues/policy.csv. It reports
#                         the IDLE FACT only — nothing records a dispatch, so it
#                         cannot tell an in-flight agent from work nobody holds, and
#                         it does not pretend to: the remedy asks for re-dispatch,
#                         release-as-blocked, or the event already earned. A slot
#                         whose idle time cannot be established BLOCKS (§17i).
#                         AND: the header line now carries the OCCUPANCY vs ACTIVITY
#                         split for every WIP-stage queue on EVERY run, because
#                         `wip: 7` reads the same whether seven agents are working or
#                         seven items are abandoned — that reading deferred 35 items
#                         for capacity that existed.
#   5 awaiting-observation [state-graph v9] every item parked in
#                         `awaiting_observation` (shipped, green, UNPROVEN) is
#                         reported AND its liveness predicate RE-EVALUATED, exactly
#                         as `blocked` is re-checked each cycle. observed (probe
#                         exit 0) BLOCKS — a tester dispatch is now actionable;
#                         not-yet (exit 3) is ADVISORY; a broken/absent predicate
#                         BLOCKS, because an unrunnable liveness predicate is not a
#                         predicate (v125 §17c.2).
#  6-14 DELEGATED checks   each computed by its own committed analyser, never
#                         re-implemented here: 6 test-requirement-gate (§17d) ·
#                         7 worktree-guard (DEFECT-OAG-076) · 8 container-reap ·
#                         14 sequencer-guard — an in-progress git operation left
#                         ARMED in a shared tree, reported WITH the count of commits
#                         `--abort` would discard; invisible to `git status
#                         --porcelain`, so no other check here can see it ·
#                         9 make-refs-tracked · 10 acceptance-audit ·
#                         11 board-mapping (DEFECT-OAG-099) — every state in
#                         state-graphs.json must carry a board-status row, because
#                         an unmapped state does not fail, it renders as unstarted
#                         BACKLOG (twice now: `cancelled`, `awaiting_observation`).
#                         Offline, project-free: `make board-audit`.
#                         An analyser that would not RUN reports UNKNOWN, never clean.
#
# Exit 2 iff a BLOCKING check fired. An advisory-only run exits 0, says so, and
# still prints the advisory (`!` line) so it cannot be read as satisfied.
#
# make loop-gate PROJECT=OagEventSource [STALE_HOURS=4] [THRESHOLD=3]
#                                       [NO_OBSERVE=1] [OBSERVE_TIMEOUT=120]
# NO_OBSERVE=1 skips re-evaluating the observation predicates (they can be slow
#   real-data queries); each parked item is then reported NOT EVALUATED, so a
#   skipped run can never read as satisfied.
loop-gate:
	$(WORKITEMS) loop-gate --project $(PROJECT) \
	  $(if $(STALE_HOURS),--stale-hours $(STALE_HOURS),) $(if $(THRESHOLD),--threshold $(THRESHOLD),) \
	  $(if $(NO_OBSERVE),--no-observe,) $(if $(OBSERVE_TIMEOUT),--observe-timeout $(OBSERVE_TIMEOUT),) \
	  $(if $(NOW),--now "$(NOW)",)

# Unit tests for the work-item machinery itself (stdlib unittest; temp-dir
# fixtures, never the real project data). Uses the SAME cross-platform
# interpreter the work-items launcher resolves — never bare python3.
# make test-wi
# The pattern is `test_*.py`, not the single file it used to name: a second test module
# added beside it (test_wi_durable_prose.py, OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT) was
# silently not discovered, which is a committed-test-that-never-runs — the same
# false-green shape as a gate in a lane nothing depends on.
test-wi:
	$(WIPY) -m unittest discover -s .claude/skills/work-items/scripts -p 'test_*.py'

# --- Event-sourced work-item machinery (design-rationale/work-item-state-model.md, process/machinery/CONTRACT.md) ---
# State lives ONLY in the per-item files (work/$(PROJECT)/items/{active,done}/<ID>.md);
# queues, stats and the dependency tree are DERIVED here, never stored-and-hand-synced.
# Append an edge-checked event (the ONLY way to change item state; rejects illegal transitions):
# make wi-append PROJECT=P ID=UC-1 EVENT=made_ready AGENT=flow-manager [REF=<sha>] [NOTE="..."] [TOKENS=<n>] [DURATION_MS=<n>] [OBSERVE=make:<target>] [OWNER=<role>[,<role>]]
# OWNER = declare WHO this item is routed to, in the SAME act as the dispatch [v11,
#   OI-ROC-006]. Firing rights are DERIVED from the item: a flow role may fire anything,
#   a validation verdict is the tester's, and everything else belongs to the item's
#   declared owner. Use it when an item is dispatched to a role outside the type default
#   (a UI defect to `ui-designer`, a docs defect to `documenter`, an architecture-only
#   fix to `solution-architect`) so that role can record its OWN work as itself instead
#   of borrowing another role's name. A declaration REPLACES the default — it narrows.
#   FLOW ROLES ONLY: an agent that could declare itself the owner would be granting
#   itself, in one command, the right it is exercising in that same command.
# TOKENS = subagent_tokens the dispatched specialist spent producing this transition (optional).
# DURATION_MS = the dispatched agent's REAL cycle time in ms for this transition (optional;
#   the dispatch layer's reported duration_ms). Feeds §F agent-cycle-time-vs-GLT in wi-project.
# OBSERVE = the machine-checkable liveness predicate, REQUIRED on EVENT=not_yet_observed
#   (entering `awaiting_observation`, state-graph v9). Form: `make:<target> [VAR=VALUE ...]`
#   — a COMMITTED, RE-RUNNABLE target in work/$(PROJECT)/Makefile that exits 0 when the
#   observation has landed and 3 when it has not (anything else = a BROKEN predicate,
#   which blocks the loop; `make` itself exits 1/2, so a missing probe can never
#   masquerade as "not observed yet"). Also accepted on the `amended` self-edge, where it
#   REPLACES the predicate in effect. Rejected on any other event. A reason in NOTE is
#   NOT a substitute: prose cannot come back negative (v125 §17c Layer 2).
#
# DURABLE PROSE MUST NOT TRANSIT A SHELL (OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT).
# `--note "$(NOTE)"` crossed make's variable expansion and then a shell double-quoted
# string, so `$` was expanded away (UC-XE1's `^…{12}$` end-anchor became an UNANCHORED
# regex in the permanent record — a different claim about the world) and a backtick was
# EXECUTED (a commit message lost a word to the macOS `open` binary actually running).
# macOS ships GNU Make 3.81, which has no `$(file …)`, so there is NO way to move prose
# out of a make variable without it crossing a shell command line.
#
# Therefore: NOTE_FILE is the safe route — a PATH has no metacharacters, so nothing can
# eat it (the same reason `git commit -F` exists) — and a NOTE= carrying a shell-active
# character is REFUSED rather than silently mangled. Fail closed: a corrupted audit
# record must not be representable.
#
#   SAFE:  printf '%s' "…prose with \$ and \` and , …" > /tmp/note.txt
#          make wi-append PROJECT=P ID=UC-1 EVENT=built_green AGENT=engineer NOTE_FILE=/tmp/note.txt
#   OK:    NOTE="plain prose, commas are fine now"      (the comma bug is closed)
#   REFUSED: NOTE="… ^x{12}$ …"  /  NOTE="… \`cmd\` …"   -> use NOTE_FILE
#
# Pinned by .claude/skills/work-items/scripts/test_wi_durable_prose.py, which drives
# these REAL targets (the Python API never saw the corruption — transport did).
#
# The probe emits only `1` or nothing — never the offending character itself. Echoing
# what it found into the guard's own shell string would reproduce the bug inside the
# check for it (a `"` in NOTE would break the `[ -n "…" ]` quoting).
NOTE_HAZARD = $(if $(strip $(findstring $$,$(value NOTE))$(findstring `,$(value NOTE))$(findstring ",$(value NOTE))$(findstring \,$(value NOTE))),1,)
wi-append:
	@if [ -n "$(NOTE_HAZARD)" ]; then \
	  echo "wi-append REFUSED: NOTE= contains a character a shell eats or EXECUTES (\$$ \` \" \\)."; \
	  echo "  It would be corrupted on the way into the permanent audit record, silently:"; \
	  echo "  a \$$ is expanded away and a backtick is RUN as a command."; \
	  echo "  Use the file route, which cannot be corrupted:"; \
	  echo "    printf '%s' '<your note>' > /tmp/note.txt"; \
	  echo "    make wi-append PROJECT=$(PROJECT) ID=$(ID) EVENT=$(EVENT) AGENT=$(AGENT) NOTE_FILE=/tmp/note.txt"; \
	  exit 1; \
	fi
	$(WORKITEMS) append --project $(PROJECT) --id $(ID) --event $(EVENT) --agent $(AGENT) \
	  $(if $(REF),--ref "$(REF)",) $(if $(NOTE),--note "$(NOTE)",) $(if $(NOTE_FILE),--note-file "$(NOTE_FILE)",) $(if $(TOKENS),--tokens "$(TOKENS)",) $(if $(DURATION_MS),--duration-ms "$(DURATION_MS)",) $(if $(OBSERVE),--observe "$(OBSERVE)",) $(if $(PROBE),--probe "$(PROBE)",) $(if $(OWNER),--owner "$(OWNER)",)
# Recompute ALL views (queues + stats + tree + re-render each item's derived block). Run after each loop.
# make wi-project PROJECT=OagEventSource
wi-project:
	$(WORKITEMS) project --project $(PROJECT) $(if $(NOW),--now "$(NOW)",)
# Drift GATE by construction (invariants I1-I4 + I6). Exit non-zero on any violation. Run before pulling.
# I6 [v9] = an `awaiting_observation` flow item carries a VALID observation predicate
#   (append refuses the transition without one, so a violation here means a hand-edit).
#   I5 stays RESERVED for IMP-011's still-owed CORE-job aggregate invariant.
# I7 [v145] = a `blocked` flow item carries a VALID reversal probe (§17c limb 6) —
#   same rule, the other park state. `blocked` is the biggest time thief in the
#   system and used to have no detector but a human remembering to re-ask.
# make wi-validate PROJECT=OagEventSource
wi-validate:
	$(WORKITEMS) validate --project $(PROJECT)

# One line per item: id, state, value/cost, defer_until, title. The triage read.
# WHY THIS EXISTS (v150 retro, ROC): deciding the aged-backlog gate's items means
# reading id + title + value + cost + defer_until for each — and `sed`-ing whole
# item files to get it produced a 45 KB dump for eight items, then a second
# hand-rolled `awk` for the same five fields. Two of the retro's three largest
# reads were this, and both were pure overhead: a parameterised target replaces a
# repeated hand-assembly (§36). STATE comes from the derived view, never re-folded.
#   make item-brief PROJECT=ROC IDS="DEF-ROC-040 OI-ROC-002"
#   make item-brief PROJECT=ROC QUEUE=intake
item-brief:
	@dir="work/$(PROJECT)/items"; \
	ids="$(IDS)"; \
	if [ -n "$(QUEUE)" ]; then \
	  ids=$$(awk -F'|' '$$2 ~ /^ *$(QUEUE) *$$/ {print $$4}' "work/$(PROJECT)/views/queues.md" | tr ',' ' '); \
	fi; \
	if [ -z "$$ids" ]; then echo "usage: make item-brief PROJECT=<p> [IDS=\"A B\"] [QUEUE=<q>]" >&2; exit 2; fi; \
	printf '%-16s %-20s %5s %5s %-12s %s\n' ID STATE VALUE COST DEFER TITLE; \
	for id in $$ids; do \
	  f=$$(ls "$$dir/active/$$id.md" "$$dir/done/$$id.md" 2>/dev/null | head -1); \
	  if [ -z "$$f" ]; then printf '%-16s %-20s\n' "$$id" "NOT-FOUND"; continue; fi; \
	  st=$$(awk -F'|' -v i="$$id" '$$2 ~ "^ *"i" *$$" {gsub(/^ +| +$$/,"",$$4); print $$4; exit}' "work/$(PROJECT)/views/state.md"); \
	  v=$$(awk -F': ' '/^value:/{print $$2; exit}' "$$f"); \
	  c=$$(awk -F': ' '/^cost:/{print $$2; exit}' "$$f"); \
	  d=$$(awk -F': ' '/^defer_until:/{print $$2; exit}' "$$f"); \
	  t=$$(awk -F'title: ' '/^title:/{print $$2; exit}' "$$f" | tr -d '"' | cut -c1-100); \
	  printf '%-16s %-20s %5s %5s %-12s %s\n' "$$id" "$${st:-?}" "$${v:-?}" "$${c:-?}" "$${d:--}" "$$t"; \
	done
# One-shot migration from items.csv + ledger into per-item files.
wi-migrate:
	$(WORKITEMS) migrate --project $(PROJECT)

# --- Board projection: work-item -> Linear issue (deterministic render) -------
# Renders ONE work item into a correctly-formed Linear issue and upserts it via
# the Linear GraphQL API, idempotently (canonical map: process/linear-mapping.md).
# REPLACES the LLM-hand-composed description (which truncated multi-line
# acceptance criteria to their first line — the defect this fixes). The `linear`
# projection agent DEPENDS on this: it shells out to `make board-project` rather
# than hand-composing a description.
#
# Runs via BOARDPY — the SAME cross-platform interpreter resolution the
# work-items launcher uses (never bare python3; the launcher skips the Windows
# Store stub and falls back to uv). linear-project.py is stdlib-only.
#   make board-project PROJECT=ROC ID=UC-ROC-015   -> upsert one item's issue
#   make test-board-project                         -> offline renderer unit test
#   make board-audit [PROJECT=OagEventSource]       -> STATE_STATUS drift audit
#
# board-audit (OI-LINEAR-CANCELLED-STATE-UNMAPPED): the state->board-status table
# is hand-maintained; the state graph is not. When they drifted, an unmapped state
# rendered as *Backlog* with no signal — a terminal `cancelled` item read as
# unstarted work for every version from state-graph v5 on. The audit compares the
# table against process/machinery/state-graphs.json in BOTH directions and, with
# PROJECT, checks every real item's (type,state) actually projects. Offline: no
# network, no secret. Non-zero on any finding. The same audit runs inside
# test-board-project, so the drift cannot reach the board unnoticed.
BOARDPY ?= $(shell sh .claude/skills/work-items/scripts/work-items --python)
.PHONY: roc-screen-gate board-project test-board-project board-audit acceptance-audit
board-project:
	$(BOARDPY) .claude/tools/linear-project.py --project $(PROJECT) --id $(ID)

test-board-project:
	$(BOARDPY) .claude/tools/linear-project.test.py

board-audit:
	$(BOARDPY) .claude/tools/linear-project.py --audit $(if $(PROJECT),--project $(PROJECT),)

# --- board-sweep: the BATCH wrapper above the single-item projection ----------
# DEFECT-OAG-099. The old "full sweep" was orchestration around `board-project`:
# loop every id, in filesystem order, writing every item whether or not it needed
# writing. On the observed run that spent the rate budget on 269 ALREADY-CORRECT
# items and then ran out, leaving 5 DONE items showing Blocked. A week later the
# same shape left UC-CSP1-1/UC-CSP1-2 — both TERMINAL — lagging for seven days,
# violating the STAGE F invariant that a terminal or blocked board status must
# never lag its item file by more than the current cycle.
#
# `linear-project.py` is deliberately UNCHANGED (small, testable, credential-safe).
# The wrapper adds only what a BATCH knows and a single item cannot:
#   ORDER    an explicit id list, or priority: terminal lag, then parked lag, then
#            the rest, most-recently-changed first inside a class.
#   SKIP     an item whose board status already equals its derived state is not
#            written at all — the only limb that REDUCES the spend rather than
#            reordering who loses to it.
#   SHORTFALL on a rate limit: stop, name every id that did not land in priority
#            order, LOUDLY, and write a resume file so the retry starts there.
#
# It REFUSES to run while STATE_STATUS has drifted from state-graphs.json — a
# state the graph defines and the mapping lacks renders as unstarted Backlog, which
# has now happened twice (cancelled, awaiting_observation). That is a precondition
# of the sweep, not a per-item surprise.
#
# MEASURED, not assumed (board-sweep.test.py): a single-item projection costs 2
# requests unlabelled, 3 labelled (4 the first time a label is created), of which
# TWO are re-reads of IMMUTABLE team metadata. A first full reconcile of ~274 items
# therefore costs ~800 requests HOWEVER it is ordered — the wrapper does not make
# the budget larger and does not pretend to. `--budget-probe` (default on) reads
# the API's own rate-limit headers before and after and reports the REAL numbers;
# if they are absent it says NOT ESTABLISHED rather than quoting a documented one.
#
#   make board-sweep PROJECT=OagEventSource                     # all, priority order
#   make board-sweep PROJECT=P IDS=UC-CSP1-1,UC-CSP1-2          # these, this order
#   make board-sweep-resume PROJECT=P                           # finish what a rate limit cut off
#   make board-sweep PROJECT=P COMPARE=full                     # also catch description drift
#   make board-sweep-plan PROJECT=P                             # priority order, NO network/secret
#   make board-sweep-dry PROJECT=P                              # read the board, write nothing
#   make test-board-sweep                                       # offline suite (29 tests)
# Exit codes: 0 clean · 2 something outstanding · 3 rate-limited (resume written)
#             4 another sweep holds the lock · 5 refused before spending anything
.PHONY: board-sweep board-sweep-resume board-sweep-plan board-sweep-dry test-board-sweep
board-sweep:
	$(BOARDPY) .claude/tools/board-sweep.py --project $(PROJECT) \
	  $(if $(IDS),--ids $(IDS),--all) $(if $(COMPARE),--compare $(COMPARE),) \
	  $(if $(MAX_WRITES),--max-writes $(MAX_WRITES),)

board-sweep-resume:
	$(BOARDPY) .claude/tools/board-sweep.py --project $(PROJECT) \
	  --ids-file $(if $(RESUME),$(RESUME),.claude/state/board-sweep-$(PROJECT).resume)

board-sweep-plan:
	$(BOARDPY) .claude/tools/board-sweep.py --project $(PROJECT) --all --offline-plan

board-sweep-dry:
	$(BOARDPY) .claude/tools/board-sweep.py --project $(PROJECT) --all --dry-run

test-board-sweep:
	$(BOARDPY) .claude/tools/board-sweep.test.py

# --- acceptance sweep + gate (OI-ACCEPTANCE-PARSER-SCORES-ZERO-SILENTLY) -------
# `parse_acceptance()` returned a COUNT, and `0` conflated two irreconcilable facts:
# "this item genuinely has no written acceptance" (a real process state - 12a keeps
# such an item out of a build) and "I could not read this item's acceptance". Nothing
# distinguished them, and the dangerous direction is FALSE-GREEN: the board stamped
# `needs-acceptance` - a WORK INSTRUCTION to go and author acceptance - on OAG-216
# (UC-GSA2) and OAG-208 (DEFECT-OAG-047), both of which carry conditions their own
# testers cited BY ID. Acting on that label means re-authoring over acceptance that
# already exists, which 12a forbids an engineer to do at all.
#
# Measured on the real 468-item corpus BEFORE the fix: 4 items carried an
# `## Acceptance` heading and parsed to ZERO, and 12 more parsed a strict SUBSET of
# the ids written in their own acceptance section - worst DEFECT-OAG-053 at 4 of 20
# (fifteen REGISTERED criteria in a table under a level-3 sub-heading, and a level-3
# heading TERMINATED the section) and DEFECT-OAG-110 at 8 of 22 (a SECOND
# `## Acceptance` section the parser never reached). All four accidental discoveries
# recorded on the item were found by someone going looking; nobody ever found one by
# being told.
#
# The parse is now robust STRUCTURALLY rather than by a fifth format (level-aware
# sections, every section, a criterion is any line that DECLARES an id) and - the
# load-bearing part - it CHECKS ITSELF: an id standing in a declaration position that
# reached no criterion makes the verdict `truncated`, so it can no longer under-count
# silently. This target is the tree-wide observer of that self-check, because a parser
# exercised one item at a time by a board sync nobody reads the stderr of has none.
#
# 17h: every class is printed with its MEASURED SIZE (including the healthy ones) and
# no class is described as benign; four of the seven can go red. An item whose
# acceptance is genuinely not enumerable is DECLARED in
# .claude/tools/acceptance-audit-declared.json with an `authority` ref - an exclusion
# with no authority FAILS, and so does a declaration whose finding has gone away, so
# the file can only shrink. Offline: no network, no secret. Wired as `loop-gate`
# check 10 and asserted by `make test-board-project`.
#   make acceptance-audit PROJECT=OagEventSource
acceptance-audit:
	$(BOARDPY) .claude/tools/linear-project.py --acceptance-audit --project $(PROJECT)

# --- Process-doc conformance gate (process §27.5) -----------------------------
# Scans the LIVE process/agent/skill/root docs for a DENYLIST of RETIRED
# QueueApproach mechanics (dora record, queues/*.csv, state.md store, blocks.csv,
# reconcile-registry, ledger-drift, sync-linear.py, dora.py flow/compute,
# project-state, item_done). Exits non-zero listing file:line for each hit, else
# prints clean. Cross-project (scans the whole repo), no PROJECT needed. Uses the
# same python the dora launcher resolves (the PY pattern). A line may carry an
# inline <!-- doc-lint:allow --> escape for a legit archive/historical mention.
#   make doc-lint
doc-lint: process-lint
	$(PY) .claude/skills/work-items/scripts/doc-lint.py

# --- Process-doc STRUCTURAL gate (process §25a / §27.5) -----------------------
# doc-lint is a DENYLIST scanner and cannot see a file that is internally
# inconsistent. process-lint checks the process files against THEMSELVES:
#   C1 the `# Current Process — vNN` heading matches the highest retro record
#      (it was 19 versions stale at v138 and stale again at v145)
#   C2 every `## EXP-` section has a registry row, and no id is defined twice
#   C3 the bare-numeric EXP id space is FROZEN — new ids are `EXP-<PROJ>-<nnn>`
#      (a global counter with per-instance writers minted `EXP-142` TWICE)
#   C4 per-project active rows are at or under the hard cap of 8, and no row is
#      unattributed (v143 routed this to "a committed tool"; this is that tool)
# Runs as a prerequisite of `doc-lint`, so the retro's step-7 gate covers both.
#   make process-lint
process-lint:
	node .claude/tools/process-lint.js

# --- Validation & smoke --------------------------------------------------------
# The validation event now rides on the work-item via `make wi-append` (tester's
# job), NOT a DORA ledger row — these targets just RUN the suite (v82).
# make validate [PROD_URL=https://…] [AWS_PROFILE=dev-int]
# PROD_URL and AWS_PROFILE are forwarded to the playwright test runner when set.
validate:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE) ,)npm --prefix $(APP) run test:validation

# make smoke [PROD_URL=https://…]
# PROD_URL is forwarded to the playwright test runner when set.
smoke:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)npm --prefix $(APP) run test:smoke

# --- WAF walking-skeleton probe (s005-h1-waf Step 9) --------------------------
# Drives the deployed CloudFront global WAFv2 ACL: HTTP burst past the rate-rule
# threshold expects >=1 edge 403, then one clean POST /api/games expects 201.
# The WS half is retired with UC2 (GATE-AMEND-H1-A). Node fetch probe is §17-
# justified — WAF acts below browser-layer concerns.
# make waf-probe BASE_URL=https://d3pf3kcvzpau1x.cloudfront.net [BURST=160]
waf-probe:
	node work/$(PROJECT)/scripts/waf-burst-probe.js --base-url $(BASE_URL) \
	  $(if $(BURST),--burst $(BURST),)

# --- WAF sustained-rate probe (s005-h1-waf AC3.1) -----------------------------
# Paces >100 POST /api/games at 1 req/1.5s across ~165s. Unlike the burst probe,
# this paced pattern gives WAF's periodic evaluation cycle (every ~30s) enough
# requests in the 300s sliding window to fire the Block action.
# Called by tests/validation/slice005-h1-waf-ac3.1.spec.ts (make validate).
# Standalone invocation for operator use (NOT the primary entry point for UC3):
# make waf-sustained BASE_URL=https://d3pf3kcvzpau1x.cloudfront.net [COUNT=110] [PACE_MS=1500]
waf-sustained:
	node work/$(PROJECT)/scripts/waf-sustained-probe.js --base-url $(BASE_URL) \
	  $(if $(COUNT),--count $(COUNT),) \
	  $(if $(PACE_MS),--pace-ms $(PACE_MS),)

# --- WS $connect authorizer walking-skeleton probe (s005-h2 T6, DEFECT-H2-002) -
# Drives the deployed REQUEST authorizer over the FULL four-path T6 acceptance in
# one asserting run: mint wsToken+code, then assert host-wsToken OPENS, guest-code
# OPENS, no-credential CLOSES, garbage-token CLOSES. Exits nonzero on any mismatch
# and records a dora row. LIVE-ENDPOINT probe — deliberately NOT in test-infra/
# test-app (those run offline). Node WS/fetch is §17-justified: the authorizer
# gate acts at the API-GW upgrade, below browser-layer concerns. Post-deploy gate,
# peer to waf-probe.
# make ws-skeleton ITER=8 SLICE=s005-h2-connect-auth \
#   API_BASE=https://d3pf3kcvzpau1x.cloudfront.net \
#   WS_URL=wss://ylbzjuo8lf.execute-api.eu-west-2.amazonaws.com/prod
ws-skeleton:
	node work/$(PROJECT)/scripts/ws-skeleton-probe.js --api-base $(API_BASE) --ws-url $(WS_URL)

# --- App / infra test entry points --------------------------------------------
test-app:
	npm --prefix $(APP) run test:run

# OI-021 UC-R1 — LIVE OAG Flight Info REST validating integration test. Drives the
# real api.oag.com/flight-instances endpoint (TPA + yesterday) through the shared
# OagRestClient + normaliseRest. SKIPS (not fails) when no credential resolves
# (OAG_REST_KEY env, else requirements/secrets/oag-rest.local.json). Excluded from
# the fast offline `make test-app` run; requires network access.
#   make test-rest-integration
test-rest-integration:
	npm --prefix $(APP) run test:integration

lint-app:
	npm --prefix $(APP) run lint

# SLC-012 UC-S7 AC-S7.2 — LIVE Dash0 E-76 stage-funnel-loss probe.
# Queries the Dash0 PromQL API (eu-west-1) for the
# oag_ingest_events_appended_total / oag_ingest_events_received_total ratio over
# a 10-min window. SKIPS (not fails) when no Dash0 API key is available. Uses the
# same vitest integration config as test-rest-integration. Requires network access.
#   make test-dash0-integration [ITER=1] [SLICE=012-schedule-ingestion]
test-dash0-integration:
	npm --prefix $(APP) run test:integration -- --reporter=verbose tests/integration/dash0-e76-funnel.integration.test.ts

# --- FIDS demo SPA (slice-010) self-service entry points -----------------------
# The FIDS SPA is a SEPARATE browser package (React+TS+Vitest/jsdom) at
# work/OagEventSource/src/fids-app — it bootstraps + folds the live category feed
# client-side (UC1 feed-client + UC2 deep-merge fold mirroring server foldAggregate).
#   make test-fids   -> vitest run (offline, fixture/mock-fetch)
#   make lint-fids   -> eslint
#   make run-fids    -> local dev server (vite) for browser-driven build/validation
FIDS := work/OagEventSource/src/fids-app
test-fids:
	npm --prefix $(FIDS) run test:run

# Integration tests for the FIDS SPA — run against the LIVE Lambda Function URL.
# Validates AC1.1 (bootstrap loop terminates at head), AC2.* (real-data fold
# correctness + thin-delta contract), AC1.3 (error/retry category). Node env,
# long timeout (up to 5 min for full bootstrap). Requires network access.
#   make test-fids-integration
test-fids-integration:
	npm --prefix $(FIDS) run test:integration

lint-fids:
	npm --prefix $(FIDS) run lint

run-fids:
	npm --prefix $(FIDS) run run-local

# SLC-036 UC-ES3 sandbox regression gate — Playwright e2e against a local vite
# dev server (port 3901, ephemeral, managed by Playwright webServer lifecycle).
# Validates AC-ES3.1..AC-ES3.4 + a11y spot-checks (A-ES1/A-ES2/A-ES5/A-ES-FIG1).
# Requires network access to the sandbox Lambda feed URL.
#   make e2e-fids-uc-es3
e2e-fids-uc-es3:
	npm --prefix $(FIDS) exec -- playwright test --config playwright.uc-es3.config.ts

# Full deployed FIDS e2e suite — Playwright against the CloudFront distribution.
# Override with FIDS_URL=https://… for a different environment.
#   make e2e-fids [FIDS_URL=https://dxo1r5kl2dn9y.cloudfront.net]
e2e-fids:
	$(if $(FIDS_URL),FIDS_URL=$(FIDS_URL) ,)npm --prefix $(FIDS) run test:e2e

# --- ROC test tiers (DEF-ROC-010) ----------------------------------------------
ROC_APP := work/ROC/src/app
# LOCAL acceptance tier (real SB/EH/Azurite emulators). Requires the stack up
# (`make roc-local-up`). Batch-runnable in ONE pass on a fresh stack; the older
# specs now run-scope their Azure tables so re-runs never collide.
# RENEWS the stack claim on entry (DEF-ROC-062, sign-of-life cadence — mirrors
# OagEventSource's ddb-local-assert-ours) so a long acceptance run never lapses
# into the reaper's unclaimed grace window mid-suite. Never fails the tier on a
# claim hiccup (`|| true`) — a real docker problem shows up in the suite itself.
#   make roc-acceptance
roc-acceptance:
	@node .claude/tools/stack-claim.js claim --project ROC || true
	npm --prefix $(ROC_APP) run test:acceptance
# Fresh emulator stack up/down (Azurite has no volume, so `up` is a clean slate).
# `up` CLAIMS the stack it just started (first sign of life); `down` RELEASES the
# claim before tearing down so no stale lease/marker outlives the containers
# (DEF-ROC-062).
roc-local-up:
	npm --prefix $(ROC_APP) run local:up
	@node .claude/tools/stack-claim.js claim --project ROC || true
roc-local-down:
	@node .claude/tools/stack-claim.js release --project ROC || true
	npm --prefix $(ROC_APP) run local:down
# UC-ROC-093 — THE TRAINER/TRAINEE PRACTICE CYCLE, end to end on the LOCAL stack.
# Runs one NAMED scenario at a teaching pace through the real pipeline (Service Bus
# emulator -> forwarder -> Event Hubs emulator -> consumer -> decision log) via the
# trainer's own `npm run local:practice` command, then PRINTS the decision-log
# read-back (row, outcome, Jira key, recordedTs and the OBSERVED gap in ms) so a
# tester validates AC-093-4 by reading actual state rather than injector stdout.
# It also drives the AC-093-3 refusal live: a non-allowlisted (cloud/production)
# namespace must refuse the whole cycle and publish nothing.
# Requires the stack up (`make roc-local-up`). Parameterised:
#   make roc-practice-cycle
#   make roc-practice-cycle ROC_UC093_SCENARIO=device-offline-recovery ROC_UC093_PACE=5000
roc-practice-cycle:
	@node .claude/tools/stack-claim.js claim --project ROC || true
	$(if $(ROC_UC093_SCENARIO),ROC_UC093_SCENARIO=$(ROC_UC093_SCENARIO) ,)$(if $(ROC_UC093_PACE),ROC_UC093_PACE=$(ROC_UC093_PACE) ,)npm --prefix $(ROC_APP) run test:acceptance -- uc093-practice-cycle

# The dashboard e2e BATTERY: runs the whole tests/e2e suite in ONE command by
# resetting + seeding each spec's own precondition (see local/e2eBattery.ts).
# Long-running (a fresh-stack reset per spec). Pass filter substrings to subset.
# RENEWS the stack claim on entry (DEF-ROC-062) — see roc-acceptance above.
#   make roc-e2e-battery
#   make roc-e2e-battery ROC_E2E_SPECS="uc-roc-046 uc-roc-069"
roc-e2e-battery:
	@node .claude/tools/stack-claim.js claim --project ROC || true
	npm --prefix $(ROC_APP) run local:e2e-battery $(if $(ROC_E2E_SPECS),-- $(ROC_E2E_SPECS),)

# --- ROC screen gate (DEF-ROC-058) --------------------------------------------
ROC_DASH := work/ROC/src/dashboard
# THE STANDING SCREEN-LEVEL UI GATE. Judges each ASSEMBLED screen as a screen —
# space allocation, column starvation, clipping, reachability and whether the
# screen states a fact it does not have — at four viewports with a measured SHORT
# page-area floor (1366x560), in real headless Chromium. No emulator, no read-api,
# no dev server, ~11s; it is on the standing green bar, which the e2e sweep
# (`make roc-e2e-battery`, the only tier that can judge PAINTED colour) is not.
#
# OI-ROC-009 ADDED A SECOND AXIS: ACCESSIBILITY. `screenAxe.browser.test.tsx` runs
# axe-core over the REAL `<App/>` — reached by clicking the REAL nav — on all four
# destinations at all four viewports. Until it landed, axe had never run in a real
# browser on any standing bar: jsdom scans a composed <App/> but has no layout, so
# every rule needing a box (target-size, scrollable-region-focusable) is
# undecidable there; the per-use-case e2e scans need the dev server + read-api and
# both their viewports are >=720 tall; and the DEF-ROC-058 limbs above are geometry
# and honesty, never axe. It turns ON `target-size` (WCAG 2.2 AA 2.5.8), which axe
# ships disabled, and turns OFF `color-contrast`, which this tier's stock-Tailwind
# stylesheet cannot judge faithfully — both declared with a reason and a named
# substitute in `SCREEN_AXE_RULE_SCOPE`, and pinned by name.
#
# It also writes ONE SCREENSHOT PER SCREEN PER VIEWPORT, because DEF-ROC-058's
# fourth blind spot is that nothing ever LOOKS at the render. Open them.
#   make roc-screen-gate
roc-screen-gate:
	npm --prefix $(ROC_DASH) run test:browser -- src/screen
	@echo ""
	@echo "=== screenshots for a human to LOOK at: $(ROC_DASH)/test-results/screen-gate/ ==="
	@ls -1 $(ROC_DASH)/test-results/screen-gate/ 2>/dev/null | sed 's/^/    /' || true

# --- ROC living-demo scenario harness (UC-ROC-051/052/080) ---------------------
ROC_DEMO := work/ROC
# The committed harness SELF-TESTS for the demo scenario machinery. No stack, no
# creds, no network — pure shell assertions on the harness + the scenario
# convention + the seven status/media scenarios' honesty about assumed wire texts.
#   make roc-demo-harness
roc-demo-harness:
	$(ROC_DEMO)/scenarios/tests/run.sh
	$(ROC_DEMO)/scenarios/tests/mode.sh
	$(ROC_DEMO)/scenarios/tests/uc080.sh
# List the seven granular status/media injection scenarios: what each injects, the
# Alert Status it must produce, and — the part that matters — WHICH wire texts are
# ASSUMED rather than captured from the real feed.
#   make roc-scenario-list
roc-scenario-list:
	npm --prefix $(ROC_APP) run --silent scenario:list
# Run the whole living-demo scenario suite (raise -> recovery -> the seven
# status/media scenarios) against a running local stack. Requires `make roc-local-up`.
# NB the suite's own docstring precondition is a FRESH stack: a long-accumulated
# Event Hubs emulator has been measured to fail ~2/10 on a mid-test alert-count
# race, so bring it up fresh before treating a failure as a code fault.
# RENEWS the stack claim on entry (DEF-ROC-062) — see roc-acceptance above.
#   make roc-scenarios
roc-scenarios:
	@node .claude/tools/stack-claim.js claim --project ROC || true
	$(ROC_DEMO)/scenarios/run-all.sh

# --- UI accessibility scan (ui-designer; design-ops, root Makefile only) -------
# Runs the axe/Playwright a11y + geometry specs (WCAG 2.2 AA contrast +
# visual-structural GEO assertions, ui-design.md §4) over the observatory SPA.
# The Playwright suite tags these specs @a11y; this target greps to them.
#   make a11y-observatory
a11y-observatory:
	npm --prefix work/observatory/src/app run test:a11y

build-app:
	npm --prefix $(APP) run build

# --- UC5 local stand-up (OI-28, principles/02) --------------------------------
# Start the full local move-relay stack with NO cloud creds: a local WS server
# (in-memory Games store + relay behind the SAME ports the cloud adapters
# implement) + the SPA dev server serving a local /config.js (wsUrl=ws://local,
# uc4Enabled=ON). Open two browser tabs at http://localhost:5183 to play, or run
# `make test-local` to drive the committed Playwright local suite against it.
#   make run-local
run-local:
	npm --prefix $(APP) run local

# Run the engineer's BUILD-phase Playwright browser suite against the local
# stand-up (full game to win/draw, out-of-turn reject, board lock). The suite
# starts the stand-up itself (playwright webServer), so no separate run-local
# process is needed.
#   make test-local
test-local:
	npm --prefix $(APP) run test:local

# s006 walking-skeleton (§17): drive ONE real move through the FULL deployed path
# in TWO REAL BROWSERS (Playwright, NOT a node probe — a node ws probe gives a
# FALSE GREEN below CSP/transport). Committed regression under tests/skeleton/.
# Post-deploy gate: requires the SPA deployed with uc4Enabled ON and the move
# route live in OxoGameProd.
#   make move-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
move-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton

test-infra:
	npm --prefix $(INFRA) test

test-lambda:
	npm --prefix work/$(PROJECT)/src/lambda test

# Unit tests for the committed scripts (IMP-008 waf-runner-ip.js etc.) — node's
# built-in runner, no AWS. Pure logic + injected-fake-CLI orchestration only.
test-scripts:
	node --test work/$(PROJECT)/scripts/*.test.js

# --- IMP-007 impacted-tests: changed-node -> impacted-spec lookup -------------
# CROSS-PROJECT agent-ops (not per-project): diffs work/<project>/architecture/
# dependencies/*.mmd since <sha> + reads working-tree `changed`-class marks, then
# greps committed specs for @covers <node-id> tags. Emits two plain-text lists
# (IMPACTED SPECS, UNCOVERED CHANGED NODES) consumable as a tester tick-off.
# Pure git + filesystem; NO creds, NO network. Exit 2 = ADVISORY warning when a
# changed node has no covering spec (wired into the tester's flow first — NOT a
# CI gate yet). PROJECT defaults to work/ACTIVE.
#   make impacted-tests SINCE=<sha> [PROJECT=oxo-online]
impacted-tests:
	node .claude/tools/impacted-tests.js --since $(SINCE) --project $(PROJECT)

# Self-tests for the cross-project agent-ops tooling under .claude/tools/
# (IMP-007 impacted-tests.js, test-requirement-gate.js). node's built-in runner,
# no creds, no network.
test-tools:
	node --test .claude/tools/*.test.js

# --- §17d test-requirement gate — "the ONLY thing tests validate is the requirements" -
# Human ruling, 2026-08-02. TWO LIMBS over the committed test sources:
#   LIMB 1  every test case declares the acceptance criterion it validates, in the
#           AC-<ID>.<n> vocabulary the codebase already uses. An untagged case is
#           either WASTE (delete it) or an UNDISCOVERED acceptance criterion
#           (register it — and the discovery gap earns a retro). The gate makes the
#           choice unavoidable; it never makes the choice.
#   LIMB 2  no AUTHORED PRECONDITIONS. A test that builds its prior by mutating a
#           real capture (`delete capture.x.y`, an override spread over a
#           corpus-loaded fixture, a hand-set folded field, a stubbed exec boundary)
#           authored the world, so it can only confirm the code. Fold the prior from
#           events, or harvest it.
# Config + committed allowlist + ratchet baseline:
#   .claude/config/test-requirement-gate/<PROJECT>.json
# `make` cannot express a three-way exit (a recipe exiting 3 makes make print
# `Error 3` and exit 2), so the verdict rides a STDOUT SENTINEL — `TRG-VERDICT:` —
# and the exit code is only 0 or 2. Also wired as loop-gate check 6, so it runs
# before EVERY pull; a gate in no workflow is not a gate.
#   make test-requirement-gate [PROJECT=OagEventSource] [MODE=enforce|ratchet|report]
#   make test-requirement-gate VERBOSE=1      # every limb-1 line
#   make test-requirement-gate-baseline       # re-cut the ratchet floor (SHRINK only)
#   make test-requirement-gate-clean          # measure HEAD, not the working tree
#
# TRIAGING A RATCHET REGRESSION — "it reads 1757 against its 1755 floor and nobody
# knows whose +2 that is" (DEFECT-OAG-106 AC-106.5; two earlier passes failed to
# answer it, this method answered it in one):
#   1. `make test-requirement-gate-clean` measures the COMMITTED (HEAD) copy of every
#      scanned file in a temp root — each root resolved in ITS OWN repo, so it spans
#      both lanes. It NEVER moves a floor.
#   2. If HEAD scores the floor exactly, the +2 is in the uncommitted range and is
#      YOURS — or an UNTRACKED `*.scratch.test.ts` a co-worker is mid-build on, which
#      counts in the working tree and not at HEAD.
#   3. Set-diff the two --json violation lists on `limb|file:line|rule` to NAME the
#      lines. That is how the original +2 was localised to two `test.skip` GUARDS.
#      make test-requirement-gate-clean JSON=1 > /tmp/head.json
#      make test-requirement-gate       JSON=1 > /tmp/tree.json
test-requirement-gate:
	node .claude/tools/test-requirement-gate.js --project $(PROJECT) \
	  $(if $(MODE),--mode $(MODE),) $(if $(VERBOSE),--verbose,) $(if $(JSON),--json,)

test-requirement-gate-baseline:
	node .claude/tools/test-requirement-gate.js --project $(PROJECT) --write-baseline

# Measure the COMMITTED tree, never the working tree. A pure diagnostic: it cannot
# write a baseline and it cannot auto-tighten (see DEFECT-OAG-106, AC-106.5).
test-requirement-gate-clean:
	node .claude/tools/test-requirement-gate.js --project $(PROJECT) --clean-tree \
	  $(if $(VERBOSE),--verbose,) $(if $(JSON),--json,)
# --- DEFECT-OAG-058 commit-isolated: the ONLY safe commit on a shared tree ----
# Up to five agents share one working tree and therefore ONE git index. Neither
# previously-prescribed remedy works: `git add -- <mine>` + `git commit` commits
# the WHOLE INDEX (b477f08 published nine files belonging to two other agents,
# and on this trunk the push IS the apply); `git commit -- <mine>` commits from
# the WORKING TREE, so it sweeps a concurrent agent's mid-edit save.
# This builds a PRIVATE index (GIT_INDEX_FILE), adds only the declared paths,
# asserts the tree diff is a subset of them, commits with commit-tree and moves
# the branch by COMPARE-AND-SWAP, then resyncs the shared index for MY paths
# only (a stale entry silently reverts my file at the next whole-index commit).
# Pure git + filesystem; NO creds, NO network.
# Exit 3 = declared-subset assertion fired (nothing committed); 4 = nothing to
# commit for those paths; 5 = branch could not be advanced; 6 = a MESSAGE guard
# fired. NOTE: `make` cannot pass a >2 exit code through — it prints `Error 6` and
# exits 2 (same limitation test-requirement-gate documents), so read the printed
# code, or call the node tool directly when you need the real status.
#
# THE MESSAGE IS DURABLE PROSE, so it gets the same treatment as an event note
# (OI-WI-APPEND-NOTE-PATH-MANGLES-CONTENT). `--message "$(MSG)"` is the identical shape
# to the `--note "$(NOTE)"` that corrupted the audit record, and it has already produced
# two live instances: a backticked word EXECUTED by zsh (the macOS `open` binary really
# ran; the word vanished from the committed message with no signal), and a multi-line
# message REFUSED outright — `/bin/sh: -c: line 0: unexpected EOF while looking for
# matching '"'`. So MSG_FILE is the route for anything multi-line or metacharacter-bearing
# (a PATH cannot be eaten — the reason `git commit -F` exists), and a hazardous MSG= is
# refused rather than silently mangled. A permanent commit nobody re-reads is exactly
# where silent corruption survives longest.
#
# AND THE MESSAGE FILE MUST BE UNIQUE TO YOU, which is a SECOND failure this target
# used to TEACH: its worked example handed out one fixed, shared /tmp message path.
# On 2026-08-21 several concurrent agents each wrote `msg.txt` into the SHARED
# per-session agent scratchpad (it held msg.txt, msg1..msg11, msgA, msgB) and a COMMIT
# MESSAGE CROSSED between two of them: e29fb8f0 landed one agent's tree under another
# agent's message, and 49e9f0a8 did it again 16 minutes later. isolated-commit's
# declared-subset assertion guards CONTENT and said nothing about the message, so the
# class was invisible to the one tool built to prevent this family — and the VICTIM of a
# clobber cannot detect it at all. Same shape as the co-owned class-deps.mmd /
# edge-ledger.md append-target: a shared location plus a non-unique name.
# So the tool now OWNS the name (`make commit-msg-file`), refuses a name with no
# identity token, re-reads the file before committing, reads the message back off the
# commit object, and refuses a message identical to a recent ancestor's.
#
#   SAFE (use this by default — the minted path cannot collide):
#     P=$$(make -s commit-msg-file); cat > "$$P" <<'EOF'
#     fix(x): intent (DEF-…)
#     EOF
#     make commit-isolated REPO=work/OagEventSource MSG_FILE="$$P" \
#                          PATHS="src/app/src/a.ts src/app/tests/a.test.ts"
#   Also fine — name the file after your work item:  MSG_FILE=<scratchpad>/msg-<ITEM-ID>.txt
#   OK for a one-liner with no metacharacters:
#     make commit-isolated REPO=work/OagEventSource MSG="fix(x): intent (DEF-…)" PATHS="a b"
#
# AND A CO-OWNED FILE IS THE SAME PROBLEM ONE LEVEL UP, measured 2026-08-26 against
# the REAL 584 KB edge-ledger.md and 568 KB class-deps.mmd: four agents each holding a
# copy read before any of them committed, four green commits, and ONE OF FOUR rows and
# nodes left in HEAD. Three items' work destroyed silently, because the private index
# is seeded from the NEW head and MY working-tree blob then REPLACES theirs — and the
# declared-subset assertion cannot see it, because the path IS declared. With the guard
# on, the same run leaves 4/4 in HEAD: a concurrent agent's committed lines are
# three-way merged back in, the merge is REPORTED, and a genuinely OVERLAPPING edit is
# refused (exit 7) rather than guessed at. Cost: +0.3-1.0s per commit at that file size.
#
#   Escape hatches, all explicit and all loud in the refusal text:
#     MSG_DUP_OK=1          a genuine re-commit of the same intent
#     MSG_FILE_SHARED_OK=1  a deliberately shared message-file name (single agent)
#     COOWNED_MERGE_OFF=1   commit MY blob verbatim over a co-owned file — i.e.
#                           REVERT a concurrent agent's committed lines. Deliberate
#                           only; this is the losing arm of the measurement above.
MSG_HAZARD = $(if $(strip $(findstring $$,$(value MSG))$(findstring `,$(value MSG))$(findstring ",$(value MSG))$(findstring \,$(value MSG))),1,)
commit-isolated:
	@if [ -n "$(MSG_HAZARD)" ]; then \
	  echo "commit-isolated REFUSED: MSG= contains a character a shell eats or EXECUTES (\$$ \` \" \\)."; \
	  echo "  A commit message is a permanent audit record and nobody re-reads it, so"; \
	  echo "  corruption here survives indefinitely: a \$$ is expanded away and a backtick"; \
	  echo "  is RUN as a command (this really happened — the macOS 'open' binary ran)."; \
	  echo "  Use the file route, which cannot be corrupted:"; \
	  echo "    P=\$$(make -s commit-msg-file)"; \
	  echo "    cat > \"\$$P\" <<'EOF'"; \
	  echo "    <your message, metacharacters and all>"; \
	  echo "    EOF"; \
	  echo "    make commit-isolated REPO=$(REPO) MSG_FILE=\"\$$P\" PATHS=\"$(PATHS)\""; \
	  exit 1; \
	fi
	node .claude/tools/isolated-commit.js --repo "$(REPO)" \
	  $(if $(MSG),--message "$(MSG)",) $(if $(MSG_FILE),--message-file "$(MSG_FILE)",) \
	  $(if $(MSG_DUP_OK),--allow-duplicate-message,) \
	  $(if $(MSG_FILE_SHARED_OK),--allow-shared-message-file,) \
	  $(if $(COOWNED_MERGE_OFF),--no-coowned-merge,) -- $(PATHS)

# Print a message-file path that CANNOT collide (pid + randomness + a digest of the
# declared paths), so a caller does not get to choose a colliding name. A convention
# ("please pick a unique filename") is the class of control this project keeps finding
# does not fire — the numbering that kept msg1..msg11 apart was unique by ACCIDENT.
#   P=$$(make -s commit-msg-file [PATHS="a b"])
commit-msg-file:
	@node .claude/tools/isolated-commit.js --mint-message-file -- $(PATHS)

# --- IMP-008 WAF runner-IP exclusion helpers ----------------------------------
# Add/remove a CIDR from the oxo-test-runner-ips WAFv2 IP set (us-east-1,
# CLOUDFRONT scope). The IP set is named 'oxo-test-runner-ips'; these targets
# resolve its ID from the stack output at call time so no hard-coded ID is
# needed. Both targets read-modify-write (append/remove from the current
# Addresses list — never replace — to survive parallel CI runs).
#
# make waf-runner-ip-add   CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
# make waf-runner-ip-remove CIDR=1.2.3.4/32 [AWS_PROFILE=dev-int]
#
# For CI use from GitHub Actions (no --profile), omit AWS_PROFILE.
waf-runner-ip-add:
	node work/$(PROJECT)/scripts/waf-runner-ip.js add $(CIDR) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

waf-runner-ip-remove:
	node work/$(PROJECT)/scripts/waf-runner-ip.js remove $(CIDR) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

# --- IMP-008 smoke-ci: runner-IP exclusion + smoke + always remove -----------
# Used by tester CI runs when the CloudFront WAF rate rule would otherwise
# block the CI runner IP. Sequence: add runner IP → smoke → remove (via trap).
# CIDR is auto-detected from checkip.amazonaws.com if not supplied.
#
# make smoke-ci ITER=10 SLICE=s007-disconnect [PROD_URL=https://…] [AWS_PROFILE=dev-int]
smoke-ci:
	@RUNNER_IP=$$(curl -s https://checkip.amazonaws.com)/32 && \
	  echo "Runner CIDR: $$RUNNER_IP" && \
	  trap "make waf-runner-ip-remove CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),)" EXIT && \
	  make waf-runner-ip-add CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),) && \
	  make smoke ITER=$(ITER) SLICE=$(SLICE) $(if $(PROD_URL),PROD_URL=$(PROD_URL),)

# --- IMP-009 L2: validate-impacted — impacted ∪ regression-core (OI-45) -------
# Per-slice FAST PATH: run only the specs whose covered nodes changed in the
# SINCE window (from make impacted-tests) UNION the committed REGRESSION CORE.
# The full make smoke / make validate remain UNCHANGED as the periodic backstop.
#
# COVERAGE GUARD (process §17, IMP-009 §3):
#   - The regression core ALWAYS runs (a break in a core user journey cannot
#     be skipped regardless of what changed).
#   - Any uncovered-changed-node in impacted-tests output STILL forces a spec
#     or explicit waiver (existing §12a rule — unchanged).
#   - The skipped specs are LOGGED in the script output (never silent coverage
#     narrowing). Run make smoke at chunk delivery as the periodic full backstop.
#
# make validate-impacted SINCE=<sha> ITER=<n> SLICE=<id> [PROJECT=…] [PROD_URL=…]
validate-impacted:
	$(if $(PROD_URL),PROD_URL=$(PROD_URL) ,)node work/$(PROJECT)/scripts/validate-impacted.js \
	  --since $(SINCE) --project $(PROJECT) \
	  $(if $(PROD_URL),--prod-url $(PROD_URL),)

# validate-impacted-ci: runner-IP exemption + validate-impacted + always remove.
# Mirrors smoke-ci for the impacted+core fast path. Use in CI / when the runner
# IP is NOT already exempt from WAF + WS authorizer rate limits.
#
# make validate-impacted-ci SINCE=<sha> ITER=<n> SLICE=<id> [PROD_URL=…] [AWS_PROFILE=dev-int]
validate-impacted-ci:
	@RUNNER_IP=$$(curl -s https://checkip.amazonaws.com)/32 && \
	  echo "Runner CIDR: $$RUNNER_IP" && \
	  trap "make waf-runner-ip-remove CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),)" EXIT && \
	  make waf-runner-ip-add CIDR=$$RUNNER_IP $(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE),) && \
	  make validate-impacted SINCE=$(SINCE) ITER=$(ITER) SLICE=$(SLICE) \
	    $(if $(PROD_URL),PROD_URL=$(PROD_URL),)

# Synth all stacks with the project-pinned CDK (not a global npx install).
# STACKS optional: make synth-infra STACKS="OxoGameProd"
# githubOrg/githubRepo go as -c context flags per process §19 (GITHUB_ env prefix is reserved).
GH_ORG  ?= john-aerocloud
GH_REPO ?= claude_learning_agents
synth-infra:
	npm --prefix $(INFRA) run cdk -- synth $(STACKS) --quiet \
	  -c githubOrg=$(GH_ORG) -c githubRepo=$(GH_REPO)

# s007 SHARED §11a probe (UC1+UC3): two-browser disconnect skeleton against the
# DEPLOYED path (Playwright, two real browsers — pair, close one tab, survivor
# sees "Your opponent disconnected." + returns to the mode selector ≤10s). NOT a
# node probe (FALSE GREEN below CSP/transport). Skeleton-gated like move-skeleton;
# green-in-prod requires UC1 handler (E4) + UC3 SPA (E5) deployed. Run post-deploy.
#   make disconnect-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
disconnect-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton:disconnect

# s008 §11a probe (UC2): deep-link boots the SPA on the DEPLOYED origin. A real
# browser creates a game to mint a real code, then a SECOND browser navigates to
# https://<domain>/join/<code> and asserts the SPA boots (NOT an edge error) with
# the code pre-filled + Join enabled. Real browser (Playwright), NOT a node probe
# (FALSE GREEN below CloudFront/CSP/transport). Skeleton-gated like move-skeleton/
# disconnect-skeleton; green-in-prod requires the UC1+UC2 SPA deployed. Run post-deploy.
#   make join-skeleton PROD_URL=https://d3pf3kcvzpau1x.cloudfront.net
join-skeleton:
	PROD_URL=$(PROD_URL) npm --prefix $(APP) run test:skeleton:join

# s005-h3 §11a probe (UC2/UC3): drive the DEPLOYED create-game path and prove the
# storage-enforced code-uniqueness invariant (delta 009, OI-3). Fires COUNT
# concurrent POST /api/games against the deployed origin and asserts ALL returned
# codes are DISTINCT — the proof the conditional-PutItem CAS truly guarantees
# uniqueness under concurrency (SM-2 lite). The create surface is a backend HTTP
# API, so the real client here is an HTTP request (no browser/CSP layer applies).
# The tester runs the full SM-2 50-concurrent + Codes-table no-duplicate-PK scan.
#   make uniqueness-probe API_BASE=https://d3pf3kcvzpau1x.cloudfront.net [COUNT=10]
COUNT ?= 10
uniqueness-probe:
	node work/$(PROJECT)/scripts/uniqueness-probe.js --api-base $(API_BASE) --count $(COUNT)

# s009 §30 walking-skeleton (T-LB-10) — the FIRST DynamoDB Stream gate. Drives ONE
# controlled active→won Games transition through the DEPLOYED stream path and
# asserts Probe A (one game-over → exactly one increment; each scoredGames carries
# the gameId once) + Probe B (replay the same transition → Leaderboard rows
# byte-identical, `already_scored` ConditionalCheckFailed in oxo-board-fn logs).
# Records a DORA validation_run row (success/fail) mirroring ws-skeleton. The §30
# real client for a DynamoDB Stream is a real DynamoDB write that fires the real
# stream — a node script using the `aws` CLI (NOT a unit mock; the mock cannot see
# real sharding/redelivery/set-contains atomicity). Post-deploy gate; MUST be
# green before UC5 (E2). Requires AWS creds in env (export the SSO profile).
#   make board-stream-skeleton ITER=14 SLICE=s009-arcade-scoreboard \
#     GAMES_TABLE=oxo-games LEADERBOARD_TABLE=oxo-leaderboard \
#     BOARD_FN_LOG_GROUP=/aws/lambda/oxo-board-fn [AWS_PROFILE=dev-int]
GAMES_TABLE        ?= oxo-games
LEADERBOARD_TABLE  ?= oxo-leaderboard
BOARD_FN_LOG_GROUP ?= /aws/lambda/oxo-board-fn
board-stream-skeleton:
	node work/$(PROJECT)/scripts/board-stream-skeleton.js \
	  --games-table $(GAMES_TABLE) --leaderboard-table $(LEADERBOARD_TABLE) \
	  --board-fn-log-group $(BOARD_FN_LOG_GROUP) \
	  $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

# --- Observatory validation entrypoints (CHK-2) --------------------------------
# test-observatory: single Vitest suite covering domain (server/__tests__) +
# SPA (src/__tests__) — one command, one project, single-server topology.
# browser-observatory: Playwright map-render + keyboard-nav specs (local).
# Both targets bypass the APP/validate machinery (observatory is local-only; no
# cloud deploy gate, no test:validation suite).
test-observatory:
	npm --prefix work/observatory/src/app run test:ci

browser-observatory:
	npm --prefix work/observatory/src/app run test:browser

# browser-observatory-ephemeral: run the Playwright browser specs against an
# EPHEMERAL Vite server on :5199 (against the committed fixture repo), so the run
# never touches an operator's running :5173. Playwright starts AND tears down the
# :5199 server itself (OBSERVATORY_E2E_PORT + CI force a non-reused own-server).
# --workers=1 SERIALISES the run: the UC-S005-6 live-refresh spec MUTATES the
# shared items.csv fixture (append a row → tree re-renders → restore in afterEach),
# so it must fully complete its restore before any deterministic spec that asserts
# an exact items.csv-derived node count / map height (work-item-tree.spec.js,
# detail-pane-geometry.spec.js) runs — single-worker sequential execution
# guarantees that with no cross-file race.
browser-observatory-ephemeral:
	OBSERVATORY_E2E_PORT=5199 CI=1 npm --prefix work/observatory/src/app run test:browser -- --workers=1

# browser-observatory-real-data: run the EXP-033 real-data spec against a
# PRE-STARTED ephemeral Vite server on :5203 (pointing at the live observatory
# repo, not the fixture). Requires the operator to have already started:
#   npm --prefix work/observatory/src/app run dev -- --port 5203
# The spec is gated on REUSE_SERVER=1 and skipped by the fixture-backed suite.
# After the run the operator should kill the :5203 server by PID (never pkill -f vite).
browser-observatory-real-data:
	OBSERVATORY_E2E_PORT=5203 REUSE_SERVER=1 npm --prefix work/observatory/src/app run test:browser -- e2e/s005-real-data.spec.js

.PHONY: project-worktree project-worktree-path project-worktrees project-foldback project-update project-worktree-remove dispatch-check worktree-guard worktree-reap sequencer-guard make-refs-tracked container-reap container-orphans stack-claim stack-release stack-status sso-login retro-debt retro-mark loop-gate test-wi wi-append wi-project wi-validate wi-migrate item-brief doc-lint process-lint validate smoke waf-probe waf-sustained ws-skeleton test-app test-rest-integration test-dash0-integration lint-app build-app run-local test-local move-skeleton test-infra synth-infra waf-runner-ip-add waf-runner-ip-remove smoke-ci validate-impacted validate-impacted-ci test-scripts disconnect-skeleton join-skeleton uniqueness-probe impacted-tests test-tools commit-isolated commit-msg-file test-requirement-gate test-requirement-gate-baseline test-requirement-gate-clean board-stream-skeleton test-observatory browser-observatory browser-observatory-ephemeral browser-observatory-real-data a11y-observatory test-fids test-fids-integration lint-fids run-fids e2e-fids e2e-fids-uc-es3 roc-acceptance roc-local-up roc-local-down roc-e2e-battery deploy-lane

# --- Viggo-fix UC-W7: Country/Nationality ID remediation (T-SQL) --------------
# Data-driven, self-building T-SQL remediation script set + its local stand-up
# test harness. Runs against SQL Server LocalDB ((localdb)\MSSQLLocalDB) via
# sqlcmd; the test target rebuilds a disposable test DB (viggo_remed_test) from
# the REAL 258 Country / 247 Nationality prod reference rows, inserts crafted
# Passenger fixtures covering every case, and asserts analyse/apply/verify/rollback.
# No creds, no network, no prod connection. PY defaults to python3 (override if the
# interpreter is elsewhere, e.g. PY="$$HOME/.local/bin/python.exe").
#   make viggo-remed-test            -> run the full TDD suite (16 cases)
#   make viggo-remed-analyse REMED_DB=<db>  -> ANALYSE report against a target DB
.PHONY: viggo-remed-test viggo-remed-analyse
viggo-remed-test:
	$(PY) work/Viggo-fix/tools/remediation/tests/test_remediation.py

# Read-only ANALYSE report against an existing target DB (must already hold the
# schema + data). REMED_DB selects the database; REMED_SERVER the instance.
viggo-remed-analyse:
	"$(SQLCMD)" -S "$(REMED_SERVER)" -d "$(REMED_DB)" \
	  -v MapDtoDEU=1 -v JunkCodes=CPH|TLD|ZZZ|YYY \
	  -i work/Viggo-fix/tools/remediation/sql/analyse.sql

# make flow-status PROJECT=oxo-online  -> recompute the DERIVED views (v82) and
# print the queues + stats. State/queues/metrics are folded from item events by
# `work-items project`; there is no dora.py flow view or queues/*.csv to count.
.PHONY: flow-status
flow-status:
	$(WORKITEMS) project --project $(PROJECT)
	@echo '--- queues ---'
	@cat work/$(PROJECT)/views/queues.md
	@echo '--- stats ---'
	@cat work/$(PROJECT)/views/stats.md
