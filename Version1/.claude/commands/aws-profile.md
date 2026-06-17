---
description: Set the AWS SSO profile used by all agents in this project. Persisted to .claude/config/aws-profile.
argument-hint: <profile-name>
allowed-tools: Read, Write, Bash
---

Write the profile name `$1` to `.claude/config/aws-profile` (overwriting the previous value).

Then confirm with a one-line summary: "AWS profile set to **$1**. Agents will use `aws sso login --profile $1` when AWS access is needed."

If `$1` is omitted, read `.claude/config/aws-profile` and report the current value without changing it.
