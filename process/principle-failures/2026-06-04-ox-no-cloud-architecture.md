# Principle deviation — AWS Well-Architected / account & network omitted

- **Date:** 2026-06-04
- **Agent:** solution-architect
- **Project:** ox
- **Principle:** Default to AWS Well-Architected; include account & network
  structure; use the `aws-architecture` skill before producing AWS design.

## Deviation

`ox` is a single-user, local console (CLI) tool with no cloud, no network, no
persistence, and no IAM. I produced no AWS design, did not use the
`aws-architecture` skill, and marked the "Accounts & network" section N/A.

## Justification

The product vision explicitly scopes out networking, persistence, and GUI. There
is no infrastructure to architect. Forcing a cloud topology would be speculative
build-ahead and pure cost with zero value. The applicable Well-Architected
pillars (Security, Reliability, Operational Excellence) were still applied at the
process/source scope, and the security review focused on the real surface
(untrusted stdin, no shell execution, no file writes).

## Reversal condition

If a future requirement adds networking, multiplayer, persistence, or a hosted
service, re-engage the `aws-architecture` skill and add account & network
structure to `architecture/current.md`.
