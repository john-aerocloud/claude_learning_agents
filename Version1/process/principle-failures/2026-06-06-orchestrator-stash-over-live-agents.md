# Orchestrator used stash choreography over live agents' working tree

**Date:** 2026-06-06
**Principle violated:** §40 (no source-control isolation choreography) — by the
orchestrator itself, against running agents.

## What happened
While background agents were mid-task in the SHARED working tree, the
orchestrator ran `git stash push -u` around a pull-rebase. The stash swept up
a live agent's in-flight workflow edits; the pop then half-failed silently
(redirected stderr hid a conflict), leaving the orchestrator's own changes
stranded in the stash and a commit that silently missed 7 of 9 intended files.
Recovery required conflict surgery on the ledger and careful unstaging of the
other agent's WIP.

## Generalised lesson
§40 applies to the orchestrator most of all: in a shared tree with concurrent
agents, stash is never safe — it cannot distinguish whose WIP is whose. The
orchestrator's commits must be add-by-explicit-path with NO stash; if a
rebase is blocked by others' WIP, the orchestrator waits or commits only what
is already staged — it never relocates another agent's uncommitted state.
Also: never redirect a mutating git command's stderr to /dev/null — the
silent half-failure was self-inflicted blindness.

## Process response
Behavioural (orchestrator agent definition + this entry); no process-text
change needed. Candidate deeper fix for retro: per-agent ledger shards (the
ledger is the one genuinely shared append file causing rebase friction).
